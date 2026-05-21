import { create } from 'zustand';
import type {
  WatchlistItem,
  ScoreSnapshot,
  ScoreHistory,
  KOLEntry,
  SentimentAlert,
  TokenFetchResult,
  NFTFetchResult,
} from '@/lib/sentiment/types';

// ─── Persistence helpers (localStorage) ──────────────────────────────────────

const STORAGE_KEY_WATCHLIST = 'wr-sentiment-watchlist';
const STORAGE_KEY_SCORES    = 'wr-sentiment-scores';
const STORAGE_KEY_HISTORY   = 'wr-sentiment-history';
const STORAGE_KEY_KOLS      = 'wr-sentiment-kols';
const STORAGE_KEY_ALERTS    = 'wr-sentiment-alerts';

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full — ignore
  }
}

// ─── Store State ─────────────────────────────────────────────────────────────

interface SentimentState {
  watchlist: WatchlistItem[];
  scores: Record<string, ScoreSnapshot>;       // watchlistId → latest score
  history: Record<string, ScoreHistory>;       // watchlistId → history
  kols: KOLEntry[];
  alerts: SentimentAlert[];
  loading: Record<string, boolean>;            // watchlistId → fetching flag
  selectedId: string | null;                  // detail panel open

  // Watchlist CRUD
  addItem: (item: WatchlistItem) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<WatchlistItem>) => void;

  // Score write
  setScore: (watchlistId: string, snapshot: ScoreSnapshot) => void;
  appendHistory: (watchlistId: string, snapshot: ScoreSnapshot) => void;

  // KOL CRUD
  addKOL: (kol: KOLEntry) => void;
  removeKOL: (id: string) => void;
  importKOLs: (kols: KOLEntry[]) => void;

  // Alerts
  addAlert: (alert: SentimentAlert) => void;
  markAlertSeen: (id: string) => void;
  clearAlerts: () => void;

  // Loading state
  setLoading: (watchlistId: string, val: boolean) => void;

  // UI selection
  selectItem: (id: string | null) => void;

  // Data load (from localStorage)
  hydrate: () => void;
}

export const useSentimentStore = create<SentimentState>((set, get) => ({
  watchlist: [],
  scores:    {},
  history:   {},
  kols:      [],
  alerts:    [],
  loading:   {},
  selectedId: null,

  // ── Watchlist ──────────────────────────────────────────────────────────────

  addItem: (item) => {
    const next = [...get().watchlist, item];
    set({ watchlist: next });
    saveJSON(STORAGE_KEY_WATCHLIST, next);
  },

  removeItem: (id) => {
    const next = get().watchlist.filter(w => w.id !== id);
    const scores  = { ...get().scores };
    const history = { ...get().history };
    delete scores[id];
    delete history[id];
    set({ watchlist: next, scores, history });
    saveJSON(STORAGE_KEY_WATCHLIST, next);
    saveJSON(STORAGE_KEY_SCORES,    scores);
    saveJSON(STORAGE_KEY_HISTORY,   history);
  },

  updateItem: (id, patch) => {
    const next = get().watchlist.map(w => w.id === id ? { ...w, ...patch } : w);
    set({ watchlist: next });
    saveJSON(STORAGE_KEY_WATCHLIST, next);
  },

  // ── Scores ────────────────────────────────────────────────────────────────

  setScore: (watchlistId, snapshot) => {
    const scores = { ...get().scores, [watchlistId]: snapshot };
    set({ scores });
    saveJSON(STORAGE_KEY_SCORES, scores);
  },

  appendHistory: (watchlistId, snapshot) => {
    const existing = get().history[watchlistId] ?? { watchlistId, entries: [] };
    const entries = [
      ...existing.entries.slice(-99),     // keep last 100 entries
      { score: snapshot.score, snapshot, createdAt: snapshot.computedAt },
    ];
    const history = { ...get().history, [watchlistId]: { watchlistId, entries } };
    set({ history });
    saveJSON(STORAGE_KEY_HISTORY, history);
  },

  // ── KOLs ──────────────────────────────────────────────────────────────────

  addKOL: (kol) => {
    const next = [...get().kols, kol];
    set({ kols: next });
    saveJSON(STORAGE_KEY_KOLS, next);
  },

  removeKOL: (id) => {
    const next = get().kols.filter(k => k.id !== id);
    set({ kols: next });
    saveJSON(STORAGE_KEY_KOLS, next);
  },

  importKOLs: (kols) => {
    // merge by handle (no duplicates)
    const existing = get().kols;
    const handles  = new Set(existing.map(k => k.twitterHandle.toLowerCase()));
    const toAdd    = kols.filter(k => !handles.has(k.twitterHandle.toLowerCase()));
    const next     = [...existing, ...toAdd];
    set({ kols: next });
    saveJSON(STORAGE_KEY_KOLS, next);
  },

  // ── Alerts ────────────────────────────────────────────────────────────────

  addAlert: (alert) => {
    const next = [alert, ...get().alerts].slice(0, 200);  // keep last 200
    set({ alerts: next });
    saveJSON(STORAGE_KEY_ALERTS, next);
  },

  markAlertSeen: (id) => {
    const next = get().alerts.map(a => a.id === id ? { ...a, seen: true } : a);
    set({ alerts: next });
    saveJSON(STORAGE_KEY_ALERTS, next);
  },

  clearAlerts: () => {
    set({ alerts: [] });
    saveJSON(STORAGE_KEY_ALERTS, []);
  },

  // ── Loading ───────────────────────────────────────────────────────────────

  setLoading: (watchlistId, val) => {
    set(s => ({ loading: { ...s.loading, [watchlistId]: val } }));
  },

  // ── UI ────────────────────────────────────────────────────────────────────

  selectItem: (id) => set({ selectedId: id }),

  // ── Hydrate ───────────────────────────────────────────────────────────────

  hydrate: () => {
    set({
      watchlist: loadJSON<WatchlistItem[]>(STORAGE_KEY_WATCHLIST, []),
      scores:    loadJSON<Record<string, ScoreSnapshot>>(STORAGE_KEY_SCORES, {}),
      history:   loadJSON<Record<string, ScoreHistory>>(STORAGE_KEY_HISTORY, {}),
      kols:      loadJSON<KOLEntry[]>(STORAGE_KEY_KOLS, []),
      alerts:    loadJSON<SentimentAlert[]>(STORAGE_KEY_ALERTS, []),
    });
  },
}));
