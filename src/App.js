import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ── SM-2 ALGORITHM (Anki-style) ───────────────────────────────────────────────
// quality: 1=fallo, 2=difícil, 3=bien, 4=fácil
function sm2(card, quality) {
  let { interval, repetitions, easeFactor } = card;
  const q = quality; // 1-4 mapped to SM2 0-5 scale internally
  const sm2q = q === 1 ? 1 : q === 2 ? 3 : q === 3 ? 4 : 5;

  if (sm2q < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  }

  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - sm2q) * (0.08 + (5 - sm2q) * 0.02));

  // Anki-style interval multipliers
  if (q === 1) interval = 1;                              // Fallo: mañana
  else if (q === 2) interval = Math.max(1, Math.round(interval * 0.5)); // Difícil: intervalo reducido
  else if (q === 4) interval = Math.round(interval * 1.3); // Fácil: intervalo aumentado

  const nextReview = Date.now() + interval * 86400000;
  return { interval, repetitions, easeFactor, nextReview, lastQuality: q, lastReview: Date.now() };
}

function defaultCard(o = {}) {
  return {
    id: crypto.randomUUID(), front: "", back: "", deckId: null,
    interval: 0, repetitions: 0, easeFactor: 2.5,
    nextReview: Date.now(), lastQuality: null, lastReview: null,
    createdAt: Date.now(), ...o
  };
}
function defaultDeck(o = {}) {
  return { id: crypto.randomUUID(), name: "Nuevo mazo", color: "#863bff", createdAt: Date.now(), ...o };
}

function useLS(key, init) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : (typeof init === "function" ? init() : init); }
    catch { return typeof init === "function" ? init() : init; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(val)); }, [key, val]);
  return [val, setVal];
}

function today() { return new Date().toISOString().split("T")[0]; }
function isDue(c) { return c.nextReview <= Date.now(); }
function isNew(c) { return c.repetitions === 0 && c.lastQuality === null; }
function isLearning(c) { return c.repetitions > 0 && c.interval < 21; }
function isMature(c) { return c.repetitions > 0 && c.interval >= 21; }

function intervalLabel(days) {
  if (days <= 1) return "mañana";
  if (days < 7) return `${days} días`;
  if (days < 30) return `${Math.round(days/7)} sem`;
  if (days < 365) return `${Math.round(days/30)} mes`;
  return `${Math.round(days/365)} año`;
}

const COLORS = ["#863bff","#ff3b7a","#3bffa0","#ffb03b","#3b82f6","#ff6b3b","#3bffe4","#c03bff"];

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [decks, setDecks] = useLS("nc_decks", []);
  const [cards, setCards] = useLS("nc_cards", []);
  const [stats, setStats] = useLS("nc_stats", { studyDays: [], totalReviews: 0, streak: 0 });
  const [view, setView] = useState("home");
  const [activeDeck, setActiveDeck] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [showAddDeck, setShowAddDeck] = useState(false);
  const [studyMode, setStudyMode] = useState("due"); // "due" | "all"

  const recordStudy = useCallback(() => {
    const tod = today();
    setStats(prev => {
      const days = (prev.studyDays || []);
      const newDays = days.includes(tod) ? days : [...days, tod].slice(-365);
      let streak = 1;
      const sorted = [...newDays].sort().reverse();
      for (let i = 1; i < sorted.length; i++) {
        if ((new Date(sorted[i-1]) - new Date(sorted[i])) / 86400000 === 1) streak++;
        else break;
      }
      return { ...prev, studyDays: newDays, totalReviews: (prev.totalReviews || 0) + 1, streak };
    });
  }, [setStats]);

  const addDeck = (name, color) => setDecks(p => [...p, defaultDeck({ name, color })]);
  const deleteDeck = (id) => {
    setDecks(p => p.filter(d => d.id !== id));
    setCards(p => p.filter(c => c.deckId !== id));
    if (activeDeck?.id === id) { setActiveDeck(null); setView("home"); }
  };
  const saveCard = (card) => setCards(p => {
    const i = p.findIndex(c => c.id === card.id);
    if (i >= 0) { const n = [...p]; n[i] = card; return n; }
    return [...p, card];
  });
  const deleteCard = (id) => setCards(p => p.filter(c => c.id !== id));
  const reviewCard = (card, q) => {
    const u = { ...card, ...sm2(card, q) };
    saveCard(u); recordStudy(); return u;
  };

  const dueCards = useMemo(() => cards.filter(isDue), [cards]);
  const dueByDeck = useMemo(() => {
    const m = {};
    dueCards.forEach(c => { m[c.deckId] = (m[c.deckId] || 0) + 1; });
    return m;
  }, [dueCards]);

  const importCards = (text, deckId) => {
    function parseCSVLine(line) {
      const r = []; let cur = "", inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if ((ch === ',' || ch === ';') && !inQ) { r.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      r.push(cur.trim()); return r;
    }
    const newCards = [];
    for (const line of text.trim().split("\n").filter(l => l.trim())) {
      const p = parseCSVLine(line);
      if (p.length >= 2) {
        const f = p[0].replace(/^"|"$/g, "").trim();
        const b = p[1].replace(/^"|"$/g, "").trim();
        if (!f || f.includes("\u6b63\u9762") || f.includes("\u95ee\u9898") || ["front","frente","frontal"].includes(f.toLowerCase())) continue;
        if (f && b) newCards.push(defaultCard({ front: f, back: b, deckId }));
      }
    }
    if (newCards.length > 0) { setCards(p => [...p, ...newCards]); return newCards.length; }
    return 0;
  };

  const openStudy = (deck, mode = "due") => {
    setActiveDeck(deck); setStudyMode(mode); setView("study");
  };

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {view === "home" && (
        <HomeView decks={decks} cards={cards} stats={stats} dueByDeck={dueByDeck}
          onAddDeck={addDeck} onOpenDeck={d => { setActiveDeck(d); setView("deck"); }}
          onStartStudy={(d, mode) => openStudy(d, mode)}
          showAddDeck={showAddDeck} setShowAddDeck={setShowAddDeck}
          totalDue={dueCards.length} />
      )}
      {view === "deck" && activeDeck && (
        <DeckView deck={activeDeck} cards={cards.filter(c => c.deckId === activeDeck.id)}
          onBack={() => setView("home")} onStudy={(mode) => openStudy(activeDeck, mode)}
          onAddCard={() => { setEditingCard(defaultCard({ deckId: activeDeck.id })); setView("addCard"); }}
          onEditCard={c => { setEditingCard(c); setView("addCard"); }}
          onDeleteCard={deleteCard} onDeleteDeck={() => deleteDeck(activeDeck.id)}
          onImport={() => setView("import")} dueCount={dueByDeck[activeDeck.id] || 0} />
      )}
      {view === "study" && activeDeck && (
        <StudyView deck={activeDeck}
          cards={cards.filter(c => c.deckId === activeDeck.id)}
          mode={studyMode}
          onReview={reviewCard} onBack={() => setView("deck")} onFinish={() => setView("deck")} />
      )}
      {view === "addCard" && editingCard && (
        <CardEditor card={editingCard} deckName={activeDeck?.name} deckColor={activeDeck?.color}
          onSave={c => { saveCard(c); setView("deck"); }} onCancel={() => setView("deck")} />
      )}
      {view === "import" && activeDeck && (
        <ImportView deck={activeDeck} onImport={t => importCards(t, activeDeck.id)} onBack={() => setView("deck")} />
      )}
    </div>
  );
}

// ── HOME ──────────────────────────────────────────────────────────────────────
function HomeView({ decks, cards, stats, dueByDeck, onAddDeck, onOpenDeck, onStartStudy, showAddDeck, setShowAddDeck, totalDue }) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const streak = stats.streak || 0;
  const mastered = cards.filter(c => isMature(c)).length;

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAddDeck(newName.trim(), newColor);
    setNewName(""); setNewColor(COLORS[0]); setShowAddDeck(false);
  };

  return (
    <div style={S.page}>
      <div style={S.orb1} /><div style={S.orb2} /><div style={S.orb3} />
      <div style={S.header}>
        <div style={S.brand}>
          <div style={S.brandIcon}>🧠</div>
          <div>
            <div style={S.brandName}>NeuroCards</div>
            <div style={S.brandSub}>Repetición espaciada · SM-2</div>
          </div>
        </div>
        <button style={S.btnNew} onClick={() => setShowAddDeck(!showAddDeck)} className="btn-glow">
          + Nuevo mazo
        </button>
      </div>

      <div style={S.heroStats}>
        <HeroStat icon="🔥" val={streak} label="días de racha" color="#ff6b3b" />
        <div style={S.heroStatDivider} />
        <HeroStat icon="🃏" val={cards.length} label="tarjetas" color="#863bff" />
        <div style={S.heroStatDivider} />
        <HeroStat icon="🎓" val={mastered} label="maduras" color="#3bffa0" />
        <div style={S.heroStatDivider} />
        <HeroStat icon="⚡" val={totalDue} label="para hoy" color="#ffb03b" urgent={totalDue > 0} />
      </div>

      {showAddDeck && (
        <div style={S.glassCard} className="fade-in">
          <div style={S.glassCardTitle}>✦ Nuevo mazo</div>
          <input style={S.input} autoFocus placeholder="Nombre del mazo..." value={newName}
            onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()} />
          <div style={{ display: "flex", gap: 10, margin: "14px 0" }}>
            {COLORS.map(c => (
              <div key={c} onClick={() => setNewColor(c)} style={{
                width: 30, height: 30, borderRadius: "50%", background: c, cursor: "pointer",
                border: newColor === c ? "3px solid #fff" : "3px solid transparent",
                boxShadow: newColor === c ? `0 0 14px ${c}` : "none", transition: "all 0.2s",
              }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...S.btnPrimary, background: `linear-gradient(135deg, ${newColor}, ${newColor}99)` }} onClick={handleAdd}>Crear mazo</button>
            <button style={S.btnGhost} onClick={() => setShowAddDeck(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {decks.length === 0 ? (
        <div style={S.emptyState}>
          <div style={S.emptyIcon}>🃏</div>
          <div style={S.emptyTitle}>Sin mazos todavía</div>
          <div style={S.emptySub}>Crea tu primer mazo o importa un CSV de NotebookLM</div>
          <button style={S.btnPrimary} onClick={() => setShowAddDeck(true)}>+ Crear primer mazo</button>
        </div>
      ) : (
        <>
          {totalDue > 0 && (
            <div style={S.dueBanner}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <span><strong style={{ color: "#ffb03b" }}>{totalDue} tarjetas</strong> esperan repaso hoy</span>
            </div>
          )}
          <div style={S.deckGrid}>
            {decks.map(deck => {
              const dc = cards.filter(c => c.deckId === deck.id);
              const due = dueByDeck[deck.id] || 0;
              const newC = dc.filter(isNew).length;
              const mature = dc.filter(isMature).length;
              const pct = dc.length > 0 ? Math.round((mature / dc.length) * 100) : 0;
              return (
                <DeckCard key={deck.id} deck={deck} total={dc.length} due={due}
                  newCount={newC} pct={pct}
                  onClick={() => onOpenDeck(deck)}
                  onStudy={e => { e.stopPropagation(); onStartStudy(deck, "due"); }}
                  onStudyAll={e => { e.stopPropagation(); onStartStudy(deck, "all"); }}
                />
              );
            })}
          </div>
        </>
      )}

      {stats.studyDays?.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <div style={S.sectionLabel}>Actividad — últimos 28 días</div>
          <Heatmap days={stats.studyDays} />
        </div>
      )}
    </div>
  );
}

function HeroStat({ icon, val, label, color, urgent }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: val > 0 ? color : "rgba(255,255,255,0.15)", lineHeight: 1, fontFamily: "'Syne', sans-serif" }}>{val}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function DeckCard({ deck, total, due, newCount, pct, onClick, onStudy, onStudyAll }) {
  return (
    <div style={S.deckCard} onClick={onClick} className="deck-card">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${deck.color}, transparent)` }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${deck.color}20`, border: `1px solid ${deck.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🃏</div>
        <div style={{ display: "flex", gap: 6 }}>
          {newCount > 0 && <span style={{ background: "#3b82f620", border: "1px solid #3b82f644", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>{newCount} nuevas</span>}
          {due > 0 && <span style={{ background: `${deck.color}20`, border: `1px solid ${deck.color}44`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: deck.color }}>{due} hoy</span>}
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 3, fontFamily: "'Syne', sans-serif" }}>{deck.name}</div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 14 }}>{total} tarjetas · {pct}% maduras</div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${deck.color}, ${deck.color}66)`, borderRadius: 2, transition: "width 0.6s" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", fontWeight: 700, fontSize: 13,
          cursor: due === 0 ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.2s",
          background: due === 0 ? "rgba(255,255,255,0.04)" : `linear-gradient(135deg, ${deck.color}, ${deck.color}88)`,
          color: due === 0 ? "rgba(255,255,255,0.2)" : "#fff",
          boxShadow: due > 0 ? `0 4px 16px ${deck.color}44` : "none",
        }} onClick={onStudy} disabled={due === 0}>
          {due === 0 ? "Al día ✓" : `▶ Estudiar ${due}`}
        </button>
        {total > 0 && due < total && (
          <button style={{ padding: "9px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
            onClick={onStudyAll} title="Estudiar todo el mazo">
            ∞
          </button>
        )}
      </div>
    </div>
  );
}

function Heatmap({ days }) {
  const last28 = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (27 - i));
    return d.toISOString().split("T")[0];
  });
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {last28.map(d => (
        <div key={d} title={d} style={{ width: 22, height: 22, borderRadius: 5,
          background: days.includes(d) ? "linear-gradient(135deg, #863bff, #ff3b7a)" : "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.05)", transition: "all 0.2s" }} />
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

  const newC = cards.filter(isNew).length;
  const learning = cards.filter(isLearning).length;
  const mature = cards.filter(isMature).length;
  const pct = cards.length > 0 ? Math.round((mature / cards.length) * 100) : 0;

  return (
    <div style={S.page}>
      <div style={S.orb1} /><div style={S.orb2} />
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button style={S.btnBack} onClick={onBack}>←</button>
          <div>
            <div style={{ ...S.brandName, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: deck.color, boxShadow: `0 0 10px ${deck.color}`, display: "inline-block" }} />
              {deck.name}
            </div>
            <div style={S.brandSub}>{cards.length} tarjetas · {pct}% maduras</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.btnGhost} onClick={onImport}>📥</button>
          <button style={S.btnGhost} onClick={onAddCard}>+</button>
          {dueCount > 0 && (
            <button style={{ ...S.btnPrimary, background: `linear-gradient(135deg, ${deck.color}, ${deck.color}88)`, boxShadow: `0 4px 20px ${deck.color}44` }}
              onClick={() => onStudy("due")}>▶ {dueCount} hoy</button>
          )}
          {cards.length > 0 && (
            <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => onStudy("all")}>∞ Todo</button>
          )}
        </div>
      </div>

      <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${deck.color}, ${deck.color}55)`, borderRadius: 2, transition: "width 0.8s" }} />
      </div>

      <div style={S.deckStatsRow}>
        {[["🆕", newC, "Nuevas", "#3b82f6"], ["📖", learning, "Aprendiendo", "#ffb03b"], ["🎓", mature, "Maduras", "#3bffa0"], ["⚡", dueCount, "Hoy", deck.color]].map(([ic, v, l, col]) => (
          <div key={l} style={S.deckStat}>
            <div style={{ fontSize: 18 }}>{ic}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: col, fontFamily: "'Syne', sans-serif" }}>{v}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{l}</div>
          </div>
        ))}
      </div>

      {cards.length > 0 && (
        <input style={{ ...S.input, marginBottom: 14 }} placeholder="🔍 Buscar tarjetas..."
          value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {filtered.length === 0 ? (
        <div style={S.emptyState}>
          <div style={S.emptyIcon}>🃏</div>
          <div style={S.emptyTitle}>{cards.length === 0 ? "Sin tarjetas aún" : "Sin resultados"}</div>
          {cards.length === 0 && (
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={S.btnPrimary} onClick={onAddCard}>+ Añadir</button>
              <button style={S.btnGhost} onClick={onImport}>📥 Importar CSV</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(card => (
            <CardRow key={card.id} card={card} deckColor={deck.color}
              onEdit={() => onEditCard(card)} onDelete={() => onDeleteCard(card.id)} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {!confirm
          ? <button style={S.btnDanger} onClick={() => setConfirm(true)}>🗑 Eliminar mazo</button>
          : <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: "#ff3b7a", fontSize: 13 }}>¿Eliminar todo?</span>
              <button style={{ ...S.btnDanger, borderColor: "#ff3b7a55", color: "#ff3b7a" }} onClick={onDeleteDeck}>Confirmar</button>
              <button style={S.btnGhost} onClick={() => setConfirm(false)}>Cancelar</button>
            </div>
        }
      </div>
    </div>
  );
}

function CardRow({ card, deckColor, onEdit, onDelete }) {
  const [label, color] = isNew(card) ? ["Nueva", "#3b82f6"] : isLearning(card) ? ["Aprendiendo", "#ffb03b"] : ["Madura", "#3bffa0"];
  const nextIn = card.interval ? intervalLabel(card.interval) : "—";
  return (
    <div style={S.cardRow} className="card-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "#fff", fontSize: 14, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.front}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${color}15`, color, border: `1px solid ${color}33` }}>{label}</span>
          {card.interval > 0 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>próximo: {nextIn}</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button style={S.iconBtn} onClick={onEdit}>✏</button>
        <button style={{ ...S.iconBtn, color: "#ff3b7a" }} onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

// ── STUDY VIEW (Anki-style) ───────────────────────────────────────────────────
const NEW_CARDS_PER_DAY = 20; // Anki default: 20 nuevas por día

function StudyView({ deck, cards, mode, onReview, onBack, onFinish }) {
  const [newLimit, setNewLimit] = useState(NEW_CARDS_PER_DAY);
  const [showSettings, setShowSettings] = useState(false);

  // Build queue like Anki: reviews first, then new (limited)
  const buildQueue = useCallback(() => {
    if (mode === "all") {
      return [...cards].sort(() => Math.random() - 0.5);
    }
    // Due reviews (repasos vencidos) — sin límite, siempre primero
    const dueReviews = cards.filter(c => isDue(c) && !isNew(c));
    const failed = dueReviews.filter(c => c.lastQuality === 1);
    const learning = dueReviews.filter(c => c.lastQuality !== 1);
    // New cards — limitadas a newLimit por sesión
    const newCards = cards.filter(isNew).slice(0, newLimit);
    return [...failed, ...learning, ...newCards];
  }, [cards, mode, newLimit]);

  const [queue, setQueue] = useState(() => buildQueue());
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [finished, setFinished] = useState(false);

  // Recalculate queue when newLimit changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setQueue(buildQueue());
    setCurrent(0);
    setFlipped(false);
  }, [newLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = queue[current];
  const remaining = queue.length - current;
  const progress = queue.length > 0 ? (current / queue.length) * 100 : 0;
  const dueReviewCount = cards.filter(c => isDue(c) && !isNew(c)).length;
  const newInQueue = queue.filter(isNew).length;

  // Preview next intervals for this card
  const nextIntervals = useMemo(() => {
    if (!card) return {};
    return {
      1: intervalLabel(1),
      2: intervalLabel(Math.max(1, Math.round((card.interval || 1) * 0.5))),
      3: intervalLabel(card.repetitions === 0 ? 1 : card.repetitions === 1 ? 6 : Math.round((card.interval || 1) * (card.easeFactor || 2.5))),
      4: intervalLabel(Math.round((card.repetitions === 0 ? 1 : card.repetitions === 1 ? 6 : Math.round((card.interval || 1) * (card.easeFactor || 2.5))) * 1.3)),
    };
  }, [card]);

  const handleRate = (quality) => {
    if (!card) return;
    const updated = onReview(card, quality);
    setSessionStats(p => ({
      ...p,
      [quality === 1 ? "again" : quality === 2 ? "hard" : quality === 3 ? "good" : "easy"]:
        (p[quality === 1 ? "again" : quality === 2 ? "hard" : quality === 3 ? "good" : "easy"] || 0) + 1
    }));

    // If failed, re-insert after ~3 cards (like Anki)
    if (quality === 1) {
      setQueue(q => {
        const next = [...q];
        const insertAt = Math.min(current + 4, next.length);
        next.splice(insertAt, 0, { ...updated, nextReview: Date.now() });
        return next;
      });
    }

    if (current + 1 >= queue.length && quality !== 1) {
      setFinished(true);
      return;
    }
    setCurrent(c => c + 1);
    setFlipped(false);
  };

  if (finished || (queue.length === 0 && !card)) {
    const total = sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy;
    const correct = sessionStats.good + sessionStats.easy;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    return (
      <div style={{ ...S.page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "90vh" }}>
        <div style={S.orb1} /><div style={S.orb2} />
        <div style={S.finishCard} className="fade-in">
          <div style={{ fontSize: 60, marginBottom: 14 }}>🎉</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 6, fontFamily: "'Syne', sans-serif" }}>¡Sesión completada!</div>
          <div style={{ color: "rgba(255,255,255,0.35)", marginBottom: 28, fontSize: 14 }}>{deck.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 28 }}>
            {[["Fallo", sessionStats.again, "#ff3b7a"], ["Difícil", sessionStats.hard, "#ffb03b"], ["Bien", sessionStats.good, "#3b82f6"], ["Fácil", sessionStats.easy, "#3bffa0"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center", background: `${c}10`, borderRadius: 10, padding: "12px 8px", border: `1px solid ${c}22` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: "'Syne', sans-serif" }}>{v}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: deck.color, marginBottom: 24, fontFamily: "'Syne', sans-serif" }}>{pct}% de acierto</div>
          <button style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", background: `linear-gradient(135deg, ${deck.color}, ${deck.color}88)`, boxShadow: `0 8px 30px ${deck.color}44` }} onClick={onFinish}>
            Volver al mazo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.orb1} /><div style={S.orb2} />

      {/* HEADER */}
      <div style={S.header}>
        <button style={S.btnBack} onClick={onBack}>← Salir</button>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
          <span style={{ color: "#ff3b7a" }}>{sessionStats.again} ✗</span>
          <span style={{ color: "#3bffa0" }}>{sessionStats.good + sessionStats.easy} ✓</span>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>{remaining} restantes</span>
          {mode !== "all" && (
            <button style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 12 }}
              onClick={() => setShowSettings(!showSettings)}>⚙</button>
          )}
        </div>
      </div>

      {/* SETTINGS PANEL */}
      {showSettings && mode !== "all" && (
        <div style={{ ...S.glassCard, marginBottom: 16, padding: "14px 18px" }} className="fade-in">
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: 1, marginBottom: 10 }}>TARJETAS NUEVAS POR SESIÓN</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {[5, 10, 15, 20, 30, 50].map(n => (
              <button key={n} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${newLimit === n ? deck.color : "rgba(255,255,255,0.1)"}`, background: newLimit === n ? `${deck.color}22` : "transparent", color: newLimit === n ? deck.color : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, transition: "all 0.15s" }}
                onClick={() => setNewLimit(n)}>{n}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 10 }}>
            Repasos vencidos: {dueReviewCount} (sin límite) · Nuevas esta sesión: {newInQueue}
          </div>
        </div>
      )}

      {/* SESSION INFO */}
      {mode !== "all" && !showSettings && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, fontSize: 12 }}>
          <div style={{ background: "rgba(255,59,122,0.1)", border: "1px solid rgba(255,59,122,0.2)", borderRadius: 8, padding: "6px 12px", color: "#ff3b7a" }}>
            📖 {dueReviewCount} repasos
          </div>
          <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "6px 12px", color: "#3b82f6" }}>
            🆕 {newInQueue} nuevas
          </div>
        </div>
      )}

      {/* PROGRESS */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 28, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, ${deck.color}, #ff3b7a)`, borderRadius: 2, transition: "width 0.4s" }} />
      </div>

      {/* CARD TYPE BADGE */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, padding: "4px 12px", borderRadius: 20,
          background: isNew(card) ? "#3b82f615" : isLearning(card) ? "#ffb03b15" : "#3bffa015",
          color: isNew(card) ? "#3b82f6" : isLearning(card) ? "#ffb03b" : "#3bffa0",
          border: `1px solid ${isNew(card) ? "#3b82f633" : isLearning(card) ? "#ffb03b33" : "#3bffa033"}`,
        }}>
          {isNew(card) ? "NUEVA" : isLearning(card) ? "APRENDIENDO" : "REPASO"}
        </span>
      </div>

      {/* FLASHCARD */}
      <div style={{ ...S.studyCard, borderColor: flipped ? `${deck.color}55` : "rgba(255,255,255,0.07)", boxShadow: flipped ? `0 0 50px ${deck.color}18` : "none", cursor: !flipped ? "pointer" : "default" }}
        onClick={!flipped ? () => setFlipped(true) : undefined}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: flipped ? deck.color : "rgba(255,255,255,0.2)", marginBottom: 20 }}>
          {flipped ? "RESPUESTA" : "PREGUNTA"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#fff", lineHeight: 1.7, textAlign: "center", fontFamily: "'Syne', sans-serif", maxWidth: 500 }}>
          {flipped ? card?.back : card?.front}
        </div>
        {!flipped && <div style={{ marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.15)" }}>Toca para ver la respuesta</div>}
      </div>

      {/* RATING BUTTONS */}
      {flipped ? (
        <div className="fade-in">
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", marginBottom: 12 }}>
            ¿Cómo te ha salido?
          </div>
          <div style={S.ratingRow}>
            {[
              { label: "Fallo", sub: nextIntervals[1], q: 1, color: "#ff3b7a" },
              { label: "Difícil", sub: nextIntervals[2], q: 2, color: "#ffb03b" },
              { label: "Bien", sub: nextIntervals[3], q: 3, color: "#3b82f6" },
              { label: "Fácil", sub: nextIntervals[4], q: 4, color: "#3bffa0" },
            ].map(({ label, sub, q, color }) => (
              <button key={label} style={{ ...S.ratingBtn, borderColor: `${color}44`, background: `${color}0e` }}
                onClick={() => handleRate(q)} className="rating-btn">
                <div style={{ fontWeight: 700, color, fontSize: 14 }}>{label}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, fontWeight: 600 }}>{sub}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", marginTop: 16,
          background: `linear-gradient(135deg, ${deck.color}, ${deck.color}88)`,
          boxShadow: `0 8px 30px ${deck.color}33` }}
          onClick={() => setFlipped(true)}>
          Mostrar respuesta
        </button>
      )}
    </div>
  );
}

// ── CARD EDITOR ───────────────────────────────────────────────────────────────
function CardEditor({ card, deckName, deckColor, onSave, onCancel }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const color = deckColor || "#863bff";

  return (
    <div style={S.page}>
      <div style={S.orb1} />
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={S.btnBack} onClick={onCancel}>←</button>
          <div>
            <div style={S.brandName}>{card.front ? "Editar tarjeta" : "Nueva tarjeta"}</div>
            <div style={S.brandSub}>{deckName}</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...S.glassCard, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>FRENTE · PREGUNTA</div>
          <textarea style={{ ...S.textarea, minHeight: 110 }} autoFocus placeholder="¿Cuál es el plazo para...?" value={front} onChange={e => setFront(e.target.value)} />
        </div>
        <div style={{ ...S.glassCard, padding: 20, borderColor: `${color}44` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color, marginBottom: 10 }}>DORSO · RESPUESTA</div>
          <textarea style={{ ...S.textarea, minHeight: 110 }} placeholder="La respuesta es..." value={back} onChange={e => setBack(e.target.value)} />
        </div>
      </div>
      {(front || back) && (
        <div style={{ marginTop: 20 }}>
          <div style={S.sectionLabel}>Vista previa</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[["FRENTE", front, "rgba(255,255,255,0.5)"], ["DORSO", back, color]].map(([l, v, c]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 14, border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: c, letterSpacing: 1, marginBottom: 8 }}>{l}</div>
                <div style={{ color: "#fff", fontSize: 13 }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button style={{ ...S.btnPrimary, background: `linear-gradient(135deg, ${color}, ${color}88)`, boxShadow: `0 8px 30px ${color}33` }}
          onClick={() => { if (front.trim() && back.trim()) onSave({ ...card, front: front.trim(), back: back.trim() }); }}>
          Guardar tarjeta
        </button>
        <button style={S.btnGhost} onClick={onCancel}>Cancelar</button>
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
    const r = new FileReader();
    r.onload = e => { setText(e.target.result.replace(/^\uFEFF/, "")); setResult(null); };
    r.readAsText(file, "UTF-8");
  };

  const handleImport = () => { const n = onImport(text); setResult(n); if (n > 0) setText(""); };

  return (
    <div style={S.page}>
      <div style={S.orb1} /><div style={S.orb2} />
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={S.btnBack} onClick={onBack}>←</button>
          <div>
            <div style={S.brandName}>Importar tarjetas</div>
            <div style={S.brandSub}>{deck.name}</div>
          </div>
        </div>
      </div>

      <div style={{ ...S.dropZone, borderColor: dragging ? deck.color : "rgba(255,255,255,0.1)", background: dragging ? `${deck.color}11` : "rgba(255,255,255,0.02)", boxShadow: dragging ? `0 0 30px ${deck.color}22` : "none" }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
        className="drop-zone">
        <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
        <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6, fontFamily: "'Syne', sans-serif" }}>Sube tu CSV de NotebookLM</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Arrastra aquí o haz clic para seleccionar</div>
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={e => readFile(e.target.files[0])} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>o pega el texto</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      <textarea style={{ ...S.textarea, minHeight: 140, fontFamily: "monospace", fontSize: 12, marginBottom: 10 }}
        placeholder="Pega aquí el contenido del CSV..." value={text}
        onChange={e => { setText(e.target.value); setResult(null); }} />

      {text && <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginBottom: 12 }}>{text.trim().split("\n").filter(l => l.trim()).length} líneas detectadas</div>}

      {result !== null && (
        <div style={{ padding: "12px 16px", borderRadius: 10, marginBottom: 16,
          background: result > 0 ? "rgba(59,255,160,0.08)" : "rgba(255,59,122,0.08)",
          border: `1px solid ${result > 0 ? "#3bffa033" : "#ff3b7a33"}`,
          color: result > 0 ? "#3bffa0" : "#ff3b7a", fontWeight: 700 }}>
          {result > 0 ? `✅ ${result} tarjetas importadas en "${deck.name}"` : "⚠️ Sin tarjetas válidas. Revisa el formato."}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...S.btnPrimary, background: `linear-gradient(135deg, ${deck.color}, ${deck.color}88)` }}
          onClick={handleImport} disabled={!text.trim()}>Importar tarjetas</button>
        <button style={S.btnGhost} onClick={onBack}>Cancelar</button>
      </div>

      <div style={{ ...S.glassCard, marginTop: 24 }}>
        <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6 }}>✅ Compatible con NotebookLM</div>
        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, lineHeight: 1.7 }}>
          Sube directamente el CSV exportado. La cabecera se elimina automáticamente.<br />
          Formatos: <code style={{ color: "#863bff" }}>frente,dorso</code> · <code style={{ color: "#863bff" }}>frente;dorso</code>
        </div>
      </div>
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const S = {
  root: { minHeight: "100vh", background: "#07080f", color: "rgba(255,255,255,0.85)", fontFamily: "'DM Sans', sans-serif", position: "relative", overflow: "hidden" },
  page: { maxWidth: 700, margin: "0 auto", padding: "28px 20px 100px", position: "relative", zIndex: 1 },
  orb1: { position: "fixed", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(134,59,255,0.14) 0%, transparent 70%)", top: -150, left: -150, pointerEvents: "none", zIndex: 0 },
  orb2: { position: "fixed", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,59,122,0.1) 0%, transparent 70%)", bottom: -100, right: -100, pointerEvents: "none", zIndex: 0 },
  orb3: { position: "fixed", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,255,160,0.06) 0%, transparent 70%)", top: "40%", right: "20%", pointerEvents: "none", zIndex: 0 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, gap: 12 },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  brandIcon: { width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #863bff, #ff3b7a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 20px rgba(134,59,255,0.35)" },
  brandName: { fontWeight: 800, color: "#fff", fontSize: 22, fontFamily: "'Syne', sans-serif", letterSpacing: -0.5 },
  brandSub: { color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 2 },
  heroStats: { display: "flex", alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "20px 12px", marginBottom: 24, backdropFilter: "blur(20px)" },
  heroStatDivider: { width: 1, height: 40, background: "rgba(255,255,255,0.06)", flexShrink: 0 },
  deckGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 },
  deckCard: { background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", borderRadius: 18, padding: 20, border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", position: "relative", overflow: "hidden", transition: "all 0.25s" },
  deckStatsRow: { display: "flex", background: "rgba(255,255,255,0.03)", borderRadius: 14, padding: "16px 0", marginBottom: 20, border: "1px solid rgba(255,255,255,0.05)" },
  deckStat: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  cardRow: { display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.05)", transition: "all 0.2s" },
  studyCard: { background: "rgba(255,255,255,0.04)", backdropFilter: "blur(30px)", borderRadius: 22, border: "1px solid", minHeight: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 36, marginBottom: 24, transition: "all 0.3s" },
  ratingRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 },
  ratingBtn: { padding: "14px 8px", borderRadius: 12, border: "1px solid", cursor: "pointer", background: "transparent", fontFamily: "inherit", transition: "all 0.15s" },
  finishCard: { background: "rgba(255,255,255,0.05)", backdropFilter: "blur(30px)", borderRadius: 24, padding: 40, textAlign: "center", border: "1px solid rgba(255,255,255,0.08)", maxWidth: 400, width: "100%" },
  glassCard: { background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", borderRadius: 14, padding: 16, border: "1px solid rgba(255,255,255,0.07)" },
  glassCardTitle: { fontWeight: 700, color: "#fff", marginBottom: 14, fontFamily: "'Syne', sans-serif" },
  dropZone: { borderRadius: 16, border: "2px dashed", padding: "36px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.25s" },
  emptyState: { textAlign: "center", padding: "60px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  emptyIcon: { fontSize: 52, marginBottom: 6 },
  emptyTitle: { fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif" },
  emptySub: { color: "rgba(255,255,255,0.3)", fontSize: 14, maxWidth: 280, lineHeight: 1.6 },
  dueBanner: { display: "flex", alignItems: "center", gap: 10, background: "rgba(255,176,59,0.08)", border: "1px solid rgba(255,176,59,0.18)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 14, color: "rgba(255,255,255,0.65)" },
  sectionLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: 12 },
  input: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, color: "#fff", padding: "11px 15px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box", outline: "none" },
  textarea: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, color: "#fff", padding: "12px 15px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box", outline: "none", resize: "vertical" },
  btnNew: { display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "linear-gradient(135deg, #863bff, #ff3b7a)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 700, boxShadow: "0 4px 20px rgba(134,59,255,0.35)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", background: "linear-gradient(135deg, #863bff, #ff3b7a)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 700, boxShadow: "0 4px 20px rgba(134,59,255,0.25)" },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 20px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  btnBack: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, color: "rgba(255,255,255,0.55)", cursor: "pointer", padding: "9px 16px", fontSize: 16, fontFamily: "inherit" },
  btnDanger: { padding: "9px 18px", background: "transparent", border: "1px solid rgba(255,59,122,0.25)", borderRadius: 10, color: "rgba(255,59,122,0.65)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  iconBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, color: "rgba(255,255,255,0.35)", cursor: "pointer", padding: "5px 10px", fontSize: 13, fontFamily: "inherit", transition: "all 0.15s" },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #07080f; }
  .deck-card:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.14) !important; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
  .card-row:hover { background: rgba(255,255,255,0.06) !important; }
  .rating-btn:hover { transform: translateY(-2px); opacity: 0.9; }
  .btn-glow:hover { box-shadow: 0 6px 30px rgba(134,59,255,0.55) !important; }
  .study-card-clickable { cursor: pointer !important; }
  .drop-zone:hover { border-color: rgba(134,59,255,0.5) !important; }
  .fade-in { animation: fadeIn 0.25s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  input:focus, textarea:focus { border-color: rgba(134,59,255,0.45) !important; box-shadow: 0 0 0 3px rgba(134,59,255,0.08); }
  button:disabled { opacity: 0.3 !important; cursor: not-allowed !important; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
  ::placeholder { color: rgba(255,255,255,0.18) !important; }
`;
