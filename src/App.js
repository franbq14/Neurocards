import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ── SM-2 ALGORITHM ──────────────────────────────────────────────────────────
function sm2(card, quality) {
  // quality: 0=blackout, 1=wrong, 2=hard, 3=ok, 4=good, 5=easy
  let { interval, repetitions, easeFactor } = card;
  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  }
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const nextReview = Date.now() + interval * 86400000;
  return { interval, repetitions, easeFactor, nextReview, lastQuality: quality };
}

function defaultCard(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    front: "",
    back: "",
    deckId: null,
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReview: Date.now(),
    lastQuality: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function defaultDeck(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Nuevo mazo",
    color: "#863bff",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── STORAGE ──────────────────────────────────────────────────────────────────
function useLS(key, init) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : (typeof init === "function" ? init() : init); }
    catch { return typeof init === "function" ? init() : init; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(val)); }, [key, val]);
  return [val, setVal];
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().split("T")[0]; }
function formatDate(ts) {
  return new Date(ts).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}
function isDue(card) { return card.nextReview <= Date.now(); }

const DECK_COLORS = ["#863bff","#e05050","#2ea87a","#c97d2e","#3b82f6","#ec4899","#14b8a6","#f59e0b"];

// ── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [decks, setDecks] = useLS("nc_decks", []);
  const [cards, setCards] = useLS("nc_cards", []);
  const [stats, setStats] = useLS("nc_stats", { studyDays: [], totalReviews: 0, streak: 0, lastStudyDate: null });
  const [view, setView] = useState("home"); // home | study | deck | addCard | import | deckStats
  const [activeDeck, setActiveDeck] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [showAddDeck, setShowAddDeck] = useState(false);

  // ── STATS UPDATE ──
  const recordStudy = useCallback((n = 1) => {
    const tod = today();
    setStats(prev => {
      const days = prev.studyDays || [];
      const newDays = days.includes(tod) ? days : [...days, tod].slice(-365);
      // streak
      let streak = 1;
      const sorted = [...newDays].sort().reverse();
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i-1]) - new Date(sorted[i])) / 86400000;
        if (diff === 1) streak++;
        else break;
      }
      return { ...prev, studyDays: newDays, totalReviews: (prev.totalReviews || 0) + n, streak, lastStudyDate: tod };
    });
  }, [setStats]);

  // ── DECK OPS ──
  const addDeck = (name, color) => {
    setDecks(prev => [...prev, defaultDeck({ name, color })]);
  };
  const deleteDeck = (id) => {
    setDecks(prev => prev.filter(d => d.id !== id));
    setCards(prev => prev.filter(c => c.deckId !== id));
    if (activeDeck?.id === id) { setActiveDeck(null); setView("home"); }
  };

  // ── CARD OPS ──
  const saveCard = (card) => {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === card.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = card; return n; }
      return [...prev, card];
    });
  };
  const deleteCard = (id) => setCards(prev => prev.filter(c => c.id !== id));

  const reviewCard = (card, quality) => {
    const updated = { ...card, ...sm2(card, quality) };
    saveCard(updated);
    recordStudy(1);
    return updated;
  };

  // ── DUE CARDS ──
  const dueCards = useMemo(() => cards.filter(isDue), [cards]);
  const dueByDeck = useMemo(() => {
    const m = {};
    dueCards.forEach(c => { m[c.deckId] = (m[c.deckId] || 0) + 1; });
    return m;
  }, [dueCards]);

  // ── IMPORT ──
  const importCards = (text, deckId) => {
    function parseCSVLine(line) {
      const result = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if ((ch === "," || ch === ";") && !inQuotes) { result.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    }
    const lines = text.trim().split("\n").filter(l => l.trim());
    const newCards = [];
    for (const line of lines) {
      const parts = parseCSVLine(line);
      if (parts.length >= 2) {
        const front = parts[0].replace(/^"|"$/g, "").trim();
        const back = parts[1].replace(/^"|"$/g, "").trim();
        if (!front || front.includes("\u6b63\u9762") || front.includes("\u95ee\u9898") || front.toLowerCase() === "front" || front.toLowerCase() === "frente") continue;
        if (front && back) newCards.push(defaultCard({ front, back, deckId }));
      }
    }
    if (newCards.length > 0) { setCards(prev => [...prev, ...newCards]); return newCards.length; }
    return 0;
  };

  const openDeck = (deck) => { setActiveDeck(deck); setView("deck"); };
  const startStudy = (deck) => { setActiveDeck(deck); setView("study"); };

  return (
    <div style={s.root}>
      <style>{css}</style>
      {view === "home" && (
        <HomeView
          decks={decks} cards={cards} stats={stats} dueByDeck={dueByDeck}
          onAddDeck={addDeck} onOpenDeck={openDeck} onStartStudy={startStudy}
          showAddDeck={showAddDeck} setShowAddDeck={setShowAddDeck}
          totalDue={dueCards.length}
        />
      )}
      {view === "deck" && activeDeck && (
        <DeckView
          deck={activeDeck} cards={cards.filter(c => c.deckId === activeDeck.id)}
          onBack={() => setView("home")} onStudy={() => setView("study")}
          onAddCard={() => { setEditingCard(defaultCard({ deckId: activeDeck.id })); setView("addCard"); }}
          onEditCard={(c) => { setEditingCard(c); setView("addCard"); }}
          onDeleteCard={deleteCard} onDeleteDeck={() => deleteDeck(activeDeck.id)}
          onImport={() => setView("import")}
          dueCount={dueByDeck[activeDeck.id] || 0}
        />
      )}
      {view === "study" && activeDeck && (
        <StudyView
          deck={activeDeck}
          cards={cards.filter(c => c.deckId === activeDeck.id && isDue(c))}
          onReview={reviewCard} onBack={() => setView("deck")}
          onFinish={() => setView("deck")}
        />
      )}
      {view === "addCard" && editingCard && (
        <CardEditor
          card={editingCard} deckName={activeDeck?.name}
          onSave={(c) => { saveCard(c); setView("deck"); }}
          onCancel={() => setView("deck")}
        />
      )}
      {view === "import" && activeDeck && (
        <ImportView
          deck={activeDeck}
          onImport={(text) => { const n = importCards(text, activeDeck.id); return n; }}
          onBack={() => setView("deck")}
        />
      )}
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────────────────
function HomeView({ decks, cards, stats, dueByDeck, onAddDeck, onOpenDeck, onStartStudy, showAddDeck, setShowAddDeck, totalDue }) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DECK_COLORS[0]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAddDeck(newName.trim(), newColor);
    setNewName(""); setNewColor(DECK_COLORS[0]); setShowAddDeck(false);
  };

  const streak = stats.streak || 0;
  const totalCards = cards.length;
  const mastered = cards.filter(c => c.repetitions >= 3 && c.easeFactor >= 2.5).length;

  return (
    <div style={s.page}>
      {/* HEADER */}
      <div style={s.header}>
        <div>
          <div style={s.logo}>🧠 NeuroCards</div>
          <div style={s.logoSub}>Repetición espaciada inteligente</div>
        </div>
        <button style={s.btnAdd} onClick={() => setShowAddDeck(!showAddDeck)}>+ Mazo</button>
      </div>

      {/* STATS BAR */}
      <div style={s.statsBar}>
        <StatPill icon="🔥" label="Racha" val={`${streak} días`} color="#e05050" />
        <StatPill icon="📦" label="Mazos" val={decks.length} color="#863bff" />
        <StatPill icon="🃏" label="Tarjetas" val={totalCards} color="#3b82f6" />
        <StatPill icon="✅" label="Dominadas" val={mastered} color="#2ea87a" />
        {totalDue > 0 && <StatPill icon="⚡" label="Para hoy" val={totalDue} color="#c97d2e" urgent />}
      </div>

      {/* ADD DECK FORM */}
      {showAddDeck && (
        <div style={s.addDeckForm}>
          <div style={s.addDeckTitle}>Nuevo mazo</div>
          <input
            style={s.input} autoFocus placeholder="Nombre del mazo..."
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
          <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
            {DECK_COLORS.map(c => (
              <div key={c} onClick={() => setNewColor(c)} style={{
                width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer",
                border: newColor === c ? "3px solid #fff" : "3px solid transparent",
                boxShadow: newColor === c ? `0 0 0 2px ${c}` : "none",
              }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.btnPrimary} onClick={handleAdd}>Crear</button>
            <button style={s.btnGhost} onClick={() => setShowAddDeck(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* DECKS */}
      {decks.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e8ecff", marginBottom: 8 }}>Sin mazos todavía</div>
          <div style={{ color: "#8b95c9" }}>Crea tu primer mazo para empezar</div>
        </div>
      ) : (
        <div style={s.deckGrid}>
          {decks.map(deck => {
            const deckCards = cards.filter(c => c.deckId === deck.id);
            const due = dueByDeck[deck.id] || 0;
            return (
              <DeckCard key={deck.id} deck={deck} total={deckCards.length} due={due}
                onClick={() => onOpenDeck(deck)}
                onStudy={(e) => { e.stopPropagation(); onStartStudy(deck); }}
              />
            );
          })}
        </div>
      )}

      {/* STUDY HISTORY */}
      {stats.studyDays?.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={s.sectionTitle}>Actividad reciente</div>
          <HeatmapWeek days={stats.studyDays} />
        </div>
      )}
    </div>
  );
}

function DeckCard({ deck, total, due, onClick, onStudy }) {
  return (
    <div style={{ ...s.deckCard, borderColor: deck.color + "44" }} onClick={onClick} className="deck-card">
      <div style={{ ...s.deckAccent, background: deck.color }} />
      <div style={s.deckName}>{deck.name}</div>
      <div style={s.deckMeta}>{total} tarjetas</div>
      {due > 0 && (
        <div style={{ ...s.dueBadge, background: deck.color + "22", color: deck.color }}>
          {due} para hoy
        </div>
      )}
      <button
        style={{ ...s.btnStudy, background: deck.color, opacity: due === 0 ? 0.4 : 1 }}
        onClick={onStudy} disabled={due === 0}
      >
        {due === 0 ? "Al día ✓" : `Estudiar ${due}`}
      </button>
    </div>
  );
}

function StatPill({ icon, label, val, color, urgent }) {
  return (
    <div style={{ ...s.statPill, ...(urgent ? { background: color + "22", border: `1px solid ${color}44` } : {}) }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
        <div style={{ fontSize: 10, color: "#8b95c9", letterSpacing: 0.5 }}>{label}</div>
      </div>
    </div>
  );
}

function HeatmapWeek({ days }) {
  const last28 = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (27 - i));
    return d.toISOString().split("T")[0];
  });
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {last28.map(d => (
        <div key={d} title={d} style={{
          width: 20, height: 20, borderRadius: 4,
          background: days.includes(d) ? "#863bff" : "#1e223a",
          transition: "background 0.2s",
        }} />
      ))}
    </div>
  );
}

// ── DECK VIEW ─────────────────────────────────────────────────────────────────
function DeckView({ deck, cards, onBack, onStudy, onAddCard, onEditCard, onDeleteCard, onDeleteDeck, onImport, dueCount }) {
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = cards.filter(c =>
    c.front.toLowerCase().includes(search.toLowerCase()) ||
    c.back.toLowerCase().includes(search.toLowerCase())
  );

  const mastered = cards.filter(c => c.repetitions >= 3).length;
  const learning = cards.filter(c => c.repetitions > 0 && c.repetitions < 3).length;
  const newCards = cards.filter(c => c.repetitions === 0).length;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={s.btnBack} onClick={onBack}>←</button>
          <div>
            <div style={{ ...s.logo, fontSize: 20 }}>
              <span style={{ color: deck.color }}>■</span> {deck.name}
            </div>
            <div style={s.logoSub}>{cards.length} tarjetas</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.btnGhost} onClick={onImport}>Importar</button>
          <button style={s.btnGhost} onClick={onAddCard}>+ Tarjeta</button>
          {dueCount > 0 && (
            <button style={{ ...s.btnPrimary, background: deck.color, borderColor: deck.color }} onClick={onStudy}>
              Estudiar {dueCount}
            </button>
          )}
        </div>
      </div>

      {/* PROGRESS */}
      <div style={s.progressSection}>
        <div style={s.progressRow}>
          <span style={{ color: "#8b95c9", fontSize: 12 }}>Nuevas</span>
          <span style={{ color: "#3b82f6", fontWeight: 700 }}>{newCards}</span>
        </div>
        <div style={s.progressRow}>
          <span style={{ color: "#8b95c9", fontSize: 12 }}>Aprendiendo</span>
          <span style={{ color: "#c97d2e", fontWeight: 700 }}>{learning}</span>
        </div>
        <div style={s.progressRow}>
          <span style={{ color: "#8b95c9", fontSize: 12 }}>Dominadas</span>
          <span style={{ color: "#2ea87a", fontWeight: 700 }}>{mastered}</span>
        </div>
        <div style={s.progressRow}>
          <span style={{ color: "#8b95c9", fontSize: 12 }}>Para hoy</span>
          <span style={{ color: deck.color, fontWeight: 700 }}>{dueCount}</span>
        </div>
      </div>

      {/* SEARCH */}
      {cards.length > 0 && (
        <input style={{ ...s.input, marginBottom: 16 }} placeholder="Buscar tarjetas..."
          value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {/* CARDS LIST */}
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🃏</div>
          <div style={{ color: "#8b95c9" }}>
            {cards.length === 0 ? "Sin tarjetas. Añade una o importa desde CSV." : "Sin resultados"}
          </div>
          {cards.length === 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button style={s.btnPrimary} onClick={onAddCard}>+ Añadir tarjeta</button>
              <button style={s.btnGhost} onClick={onImport}>Importar CSV</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(card => (
            <CardItem key={card.id} card={card}
              onEdit={() => onEditCard(card)}
              onDelete={() => onDeleteCard(card.id)}
            />
          ))}
        </div>
      )}

      {/* DELETE DECK */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #1e223a" }}>
        {!confirm ? (
          <button style={s.btnDanger} onClick={() => setConfirm(true)}>🗑 Eliminar mazo</button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#e05050", fontSize: 13 }}>¿Eliminar todo?</span>
            <button style={{ ...s.btnDanger, padding: "6px 14px" }} onClick={onDeleteDeck}>Confirmar</button>
            <button style={s.btnGhost} onClick={() => setConfirm(false)}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CardItem({ card, onEdit, onDelete }) {
  const level = card.repetitions === 0 ? { label: "Nueva", color: "#3b82f6" }
    : card.repetitions < 3 ? { label: "Aprendiendo", color: "#c97d2e" }
    : { label: "Dominada", color: "#2ea87a" };

  return (
    <div style={s.cardItem}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "#e8ecff", fontSize: 14, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.front}
        </div>
        <div style={{ color: "#8b95c9", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.back}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ ...s.tag, color: level.color, background: level.color + "22" }}>{level.label}</span>
        <button style={s.btnIcon} onClick={onEdit}>✏</button>
        <button style={{ ...s.btnIcon, color: "#e05050" }} onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

// ── STUDY VIEW ────────────────────────────────────────────────────────────────
function StudyView({ deck, cards, onReview, onBack, onFinish }) {
  const [queue, setQueue] = useState(() => [...cards].sort(() => Math.random() - 0.5));
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [sessionResults, setSessionResults] = useState([]);
  const [finished, setFinished] = useState(false);
  const cardRef = useRef(null);

  const card = queue[current];
  const total = queue.length;
  const progress = total > 0 ? (current / total) * 100 : 0;

  const handleFlip = () => setFlipped(true);

  const handleRate = (quality) => {
    if (!card) return;
    const updated = onReview(card, quality);
    setSessionResults(prev => [...prev, { card, quality }]);
    setDone(d => d + 1);

    // If wrong (< 3), re-add to queue later
    if (quality < 3) {
      setQueue(prev => {
        const newQ = [...prev];
        const insertAt = Math.min(current + 3, newQ.length);
        newQ.splice(insertAt, 0, { ...updated, nextReview: Date.now() });
        return newQ;
      });
    }

    if (current + 1 >= queue.length && quality >= 3) {
      setFinished(true);
    } else {
      setCurrent(c => c + 1);
      setFlipped(false);
    }
  };

  if (finished || queue.length === 0) {
    const correct = sessionResults.filter(r => r.quality >= 3).length;
    const total2 = sessionResults.length;
    const pct = total2 > 0 ? Math.round((correct / total2) * 100) : 0;
    return (
      <div style={{ ...s.page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh" }}>
        <div style={s.finishCard}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#e8ecff", marginBottom: 8 }}>¡Sesión completada!</div>
          <div style={{ color: "#8b95c9", marginBottom: 24 }}>{deck.name}</div>
          <div style={s.finishStats}>
            <div style={s.finishStat}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#2ea87a" }}>{correct}</div>
              <div style={{ fontSize: 11, color: "#8b95c9" }}>Correctas</div>
            </div>
            <div style={s.finishStat}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#e05050" }}>{total2 - correct}</div>
              <div style={{ fontSize: 11, color: "#8b95c9" }}>A repasar</div>
            </div>
            <div style={s.finishStat}>
              <div style={{ fontSize: 28, fontWeight: 700, color: deck.color }}>{pct}%</div>
              <div style={{ fontSize: 11, color: "#8b95c9" }}>Acierto</div>
            </div>
          </div>
          <button style={{ ...s.btnPrimary, marginTop: 24, width: "100%" }} onClick={onFinish}>
            Volver al mazo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* HEADER */}
      <div style={s.header}>
        <button style={s.btnBack} onClick={onBack}>← Salir</button>
        <div style={{ color: "#8b95c9", fontSize: 13 }}>
          {current + 1} / {queue.length}
        </div>
      </div>

      {/* PROGRESS BAR */}
      <div style={s.studyProgress}>
        <div style={{ ...s.studyProgressFill, width: `${progress}%`, background: deck.color }} />
      </div>

      {/* CARD */}
      <div style={s.studyArea}>
        <div ref={cardRef} style={{ ...s.flashcard, borderColor: deck.color + "44" }} onClick={!flipped ? handleFlip : undefined}>
          {!flipped ? (
            <div style={s.cardContent}>
              <div style={s.cardSide}>PREGUNTA</div>
              <div style={s.cardText}>{card?.front}</div>
              <div style={s.cardHint}>Toca para ver la respuesta</div>
            </div>
          ) : (
            <div style={s.cardContent}>
              <div style={{ ...s.cardSide, color: deck.color }}>RESPUESTA</div>
              <div style={{ ...s.cardText, color: "#e8ecff" }}>{card?.back}</div>
            </div>
          )}
        </div>

        {/* RATING BUTTONS */}
        {flipped && (
          <div style={s.ratingArea}>
            <div style={{ color: "#8b95c9", fontSize: 12, marginBottom: 12, textAlign: "center" }}>
              ¿Cómo te ha salido?
            </div>
            <div style={s.ratingButtons}>
              <RatingBtn label="Fallo" sub="Repasar ya" quality={1} color="#e05050" onClick={handleRate} />
              <RatingBtn label="Difícil" sub="Repasar pronto" quality={2} color="#c97d2e" onClick={handleRate} />
              <RatingBtn label="Bien" sub="Intervalo normal" quality={3} color="#3b82f6" onClick={handleRate} />
              <RatingBtn label="Fácil" sub="Intervalo largo" quality={5} color="#2ea87a" onClick={handleRate} />
            </div>
          </div>
        )}

        {!flipped && (
          <button style={{ ...s.btnPrimary, width: "100%", marginTop: 16, background: deck.color, borderColor: deck.color }} onClick={handleFlip}>
            Mostrar respuesta
          </button>
        )}
      </div>
    </div>
  );
}

function RatingBtn({ label, sub, quality, color, onClick }) {
  return (
    <button style={{ ...s.ratingBtn, borderColor: color + "55", background: color + "11" }}
      onClick={() => onClick(quality)}
      className="rating-btn"
    >
      <div style={{ fontWeight: 700, color, fontSize: 14 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#8b95c9", marginTop: 2 }}>{sub}</div>
    </button>
  );
}

// ── CARD EDITOR ───────────────────────────────────────────────────────────────
function CardEditor({ card, deckName, onSave, onCancel }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);

  const handleSave = () => {
    if (!front.trim() || !back.trim()) return;
    onSave({ ...card, front: front.trim(), back: back.trim() });
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={s.btnBack} onClick={onCancel}>←</button>
          <div style={s.logo}>{card.id ? "Editar tarjeta" : "Nueva tarjeta"}</div>
        </div>
        <div style={{ color: "#8b95c9", fontSize: 13 }}>{deckName}</div>
      </div>

      <div style={s.editorArea}>
        <div style={s.editorCard}>
          <label style={s.editorLabel}>FRENTE (pregunta)</label>
          <textarea style={{ ...s.textarea, minHeight: 120 }} autoFocus
            placeholder="¿Cuál es el plazo para...?"
            value={front} onChange={e => setFront(e.target.value)}
          />
        </div>
        <div style={{ ...s.editorCard, borderColor: "#863bff44" }}>
          <label style={{ ...s.editorLabel, color: "#863bff" }}>DORSO (respuesta)</label>
          <textarea style={{ ...s.textarea, minHeight: 120 }}
            placeholder="La respuesta es..."
            value={back} onChange={e => setBack(e.target.value)}
          />
        </div>
      </div>

      {/* PREVIEW */}
      {(front || back) && (
        <div style={s.previewSection}>
          <div style={s.sectionTitle}>Vista previa</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={s.previewCard}>
              <div style={s.cardSide}>FRENTE</div>
              <div style={{ color: "#e8ecff", fontSize: 14 }}>{front || "—"}</div>
            </div>
            <div style={{ ...s.previewCard, borderColor: "#863bff44" }}>
              <div style={{ ...s.cardSide, color: "#863bff" }}>DORSO</div>
              <div style={{ color: "#e8ecff", fontSize: 14 }}>{back || "—"}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button style={s.btnPrimary} onClick={handleSave}>Guardar tarjeta</button>
        <button style={s.btnGhost} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ── IMPORT VIEW ───────────────────────────────────────────────────────────────
function ImportView({ deck, onImport, onBack }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // Remove BOM if present
      const raw = e.target.result.replace(/^\uFEFF/, "");
      setText(raw);
      setResult(null);
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleFilePick = (e) => readFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    readFile(e.dataTransfer.files[0]);
  };

  const handleImport = () => {
    const n = onImport(text);
    setResult(n);
    if (n > 0) { setText(""); }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={s.btnBack} onClick={onBack}>←</button>
          <div style={s.logo}>Importar tarjetas</div>
        </div>
        <div style={{ color: "#8b95c9", fontSize: 13 }}>{deck.name}</div>
      </div>

      {/* FILE DROP ZONE */}
      <div
        style={{
          border: `2px dashed ${dragging ? "#863bff" : "#2a2f4a"}`,
          borderRadius: 12, padding: "32px 20px", textAlign: "center",
          marginBottom: 16, cursor: "pointer", transition: "all 0.2s",
          background: dragging ? "#863bff11" : "#0e1229",
        }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
        <div style={{ fontWeight: 700, color: "#e8ecff", marginBottom: 4 }}>
          Sube tu CSV de NotebookLM
        </div>
        <div style={{ color: "#8b95c9", fontSize: 13 }}>
          Arrastra el archivo aquí o haz clic para seleccionarlo
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleFilePick} />
      </div>

      {/* OR divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: "#1e223a" }} />
        <span style={{ color: "#8b95c9", fontSize: 12 }}>o pega el texto directamente</span>
        <div style={{ flex: 1, height: 1, background: "#1e223a" }} />
      </div>

      <textarea
        style={{ ...s.textarea, minHeight: 160, marginBottom: 12, fontFamily: "monospace", fontSize: 12 }}
        placeholder={"Pega aquí el contenido del CSV..."}
        value={text} onChange={e => { setText(e.target.value); setResult(null); }}
      />

      {text && (
        <div style={{ color: "#8b95c9", fontSize: 12, marginBottom: 12 }}>
          {text.trim().split("\n").filter(l => l.trim()).length} líneas detectadas
        </div>
      )}

      {result !== null && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12,
          background: result > 0 ? "#2ea87a22" : "#e0505022",
          color: result > 0 ? "#2ea87a" : "#e05050",
          fontSize: 13, fontWeight: 600 }}>
          {result > 0 ? `✅ ${result} tarjetas importadas en "${deck.name}"` : "⚠️ No se encontraron tarjetas válidas. Revisa el formato."}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button style={s.btnPrimary} onClick={handleImport} disabled={!text.trim()}>
          Importar tarjetas
        </button>
        <button style={s.btnGhost} onClick={onBack}>Cancelar</button>
      </div>

      <div style={{ marginTop: 24, background: "#13182e", borderRadius: 10, padding: 16, border: "1px solid #1e223a" }}>
        <div style={{ fontWeight: 700, color: "#e8ecff", marginBottom: 6 }}>✅ Compatible con NotebookLM</div>
        <div style={{ color: "#8b95c9", fontSize: 13, lineHeight: 1.6 }}>
          Sube directamente el CSV que exporta NotebookLM. La cabecera se elimina automáticamente.
          También acepta cualquier CSV con formato <code style={{ color: "#e8ecff" }}>frente,dorso</code> o <code style={{ color: "#e8ecff" }}>frente;dorso</code>.
        </div>
      </div>
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const s = {
  root: { minHeight: "100vh", background: "#0a0d1a", color: "#c5cae9", fontFamily: "'DM Mono', monospace" },
  page: { maxWidth: 680, margin: "0 auto", padding: "24px 16px 80px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 12 },
  logo: { fontWeight: 700, color: "#e8ecff", fontSize: 22, letterSpacing: -0.5 },
  logoSub: { color: "#8b95c9", fontSize: 12, marginTop: 2 },
  statsBar: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 },
  statPill: { display: "flex", alignItems: "center", gap: 10, background: "#0e1229", borderRadius: 10, padding: "10px 14px", border: "1px solid #1e223a", flex: "1 1 80px" },
  addDeckForm: { background: "#0e1229", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #1e223a" },
  addDeckTitle: { fontWeight: 700, color: "#e8ecff", marginBottom: 12 },
  deckGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  deckCard: { background: "#0e1229", borderRadius: 12, padding: 20, border: "1px solid", cursor: "pointer", position: "relative", overflow: "hidden", transition: "transform 0.15s, box-shadow 0.15s" },
  deckAccent: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  deckName: { fontWeight: 700, color: "#e8ecff", fontSize: 16, marginBottom: 4, marginTop: 8 },
  deckMeta: { color: "#8b95c9", fontSize: 13, marginBottom: 12 },
  dueBadge: { display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, marginBottom: 12 },
  btnStudy: { width: "100%", padding: "10px 0", borderRadius: 8, border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  empty: { textAlign: "center", padding: "60px 20px", color: "#8b95c9" },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#8b95c9", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  progressSection: { display: "flex", gap: 0, background: "#0e1229", borderRadius: 10, padding: "12px 16px", marginBottom: 20, border: "1px solid #1e223a" },
  progressRow: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  cardItem: { display: "flex", alignItems: "center", gap: 12, background: "#0e1229", borderRadius: 8, padding: "12px 14px", border: "1px solid #1e223a" },
  tag: { fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4 },
  btnIcon: { background: "transparent", border: "1px solid #2a2f4a", borderRadius: 6, color: "#8b95c9", cursor: "pointer", padding: "4px 8px", fontSize: 13, fontFamily: "inherit" },
  studyProgress: { height: 4, background: "#1e223a", borderRadius: 2, marginBottom: 24, overflow: "hidden" },
  studyProgressFill: { height: "100%", borderRadius: 2, transition: "width 0.4s ease" },
  studyArea: { display: "flex", flexDirection: "column", alignItems: "stretch" },
  flashcard: { background: "#0e1229", borderRadius: 16, border: "2px solid", minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 32, marginBottom: 20, transition: "border-color 0.2s" },
  cardContent: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", textAlign: "center" },
  cardSide: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#8b95c9", textTransform: "uppercase" },
  cardText: { fontSize: 22, fontWeight: 600, color: "#c5cae9", lineHeight: 1.5 },
  cardHint: { fontSize: 12, color: "#3a3f5c", marginTop: 8 },
  ratingArea: { marginTop: 8 },
  ratingButtons: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  ratingBtn: { padding: "12px 8px", borderRadius: 10, border: "1px solid", cursor: "pointer", background: "transparent", fontFamily: "inherit", transition: "transform 0.1s, opacity 0.1s" },
  finishCard: { background: "#0e1229", borderRadius: 16, padding: 40, textAlign: "center", border: "1px solid #1e223a", maxWidth: 380, width: "100%" },
  finishStats: { display: "flex", gap: 24, justifyContent: "center" },
  finishStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  editorArea: { display: "flex", flexDirection: "column", gap: 12 },
  editorCard: { background: "#0e1229", borderRadius: 10, padding: 16, border: "1px solid #1e223a" },
  editorLabel: { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#8b95c9", marginBottom: 10, textTransform: "uppercase" },
  previewSection: { marginTop: 20 },
  previewCard: { background: "#0e1229", borderRadius: 10, padding: 14, border: "1px solid #1e223a" },
  input: { background: "#0e1229", border: "1px solid #2a2f4a", borderRadius: 8, color: "#e8ecff", padding: "10px 14px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box", outline: "none" },
  textarea: { background: "#0e1229", border: "1px solid #2a2f4a", borderRadius: 8, color: "#e8ecff", padding: "12px 14px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box", outline: "none", resize: "vertical" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#863bff22", border: "1px solid #863bff", borderRadius: 8, color: "#863bff", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 700 },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "transparent", border: "1px solid #2a2f4a", borderRadius: 8, color: "#8b95c9", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  btnBack: { background: "transparent", border: "1px solid #2a2f4a", borderRadius: 8, color: "#8b95c9", cursor: "pointer", padding: "8px 14px", fontSize: 16, fontFamily: "inherit" },
  btnAdd: { padding: "8px 16px", background: "#863bff22", border: "1px solid #863bff", borderRadius: 8, color: "#863bff", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 700 },
  btnDanger: { padding: "8px 16px", background: "transparent", border: "1px solid #e0505044", borderRadius: 8, color: "#e05050", cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
};

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0d1a; }
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
  .deck-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
  .rating-btn:hover { transform: translateY(-2px); opacity: 0.9; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  input:focus, textarea:focus { border-color: #863bff !important; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0a0d1a; }
  ::-webkit-scrollbar-thumb { background: #2a2f4a; border-radius: 3px; }
  select option { background: #13182e; }
`;
