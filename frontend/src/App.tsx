import { useEffect, useMemo, useState } from "react";

type FieldType = "text" | "longtext" | "number" | "money" | "date" | "choice" | "yesno" | "rating";

type TrackerField = {
  key?: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  archived: boolean;
  optionsText?: string;
};

type Tracker = {
  id: string;
  name: string;
  icon: string;
  color: string;
  fields: TrackerField[];
};

type EntryValue = string | number | boolean;

type Entry = {
  id: string;
  trackerId: string;
  at: string;
  deleted: boolean;
  data: Record<string, EntryValue>;
};

type ApiEntry = Omit<Entry, "trackerId"> & { tracker_id: string };

type Db = {
  trackers: Tracker[];
  entries: Entry[];
};

type View = "home" | "tracker";
type Tab = "entries" | "stats";
type Sheet = "builder" | "entry" | null;

type DraftTracker = {
  id: string | null;
  name: string;
  icon: string;
  fields: TrackerField[];
  hidden: TrackerField[];
  removed: TrackerField[];
  error: string;
  confirmDel: boolean;
};

type EntryDraft = {
  at: string;
  data: Record<string, EntryValue>;
  error: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
const TOKEN_KEY = "my-trackers-token";
let authToken = localStorage.getItem(TOKEN_KEY) ?? "";
const TYPES: Array<[FieldType, string]> = [
  ["text", "Short text"],
  ["longtext", "Long note"],
  ["number", "Number"],
  ["money", "Money (₹)"],
  ["date", "Date"],
  ["choice", "Choice list"],
  ["yesno", "Yes / No"],
  ["rating", "Rating (1-5)"]
];
const COLORS = ["#3B4BDB", "#0E9F8E", "#E0662B", "#B83280", "#5B8C1F", "#C08A00", "#7A4FD6", "#D6455D"];
const ICONS = ["🍜", "📚", "🏋️", "🧩", "🎬", "😴", "✈️", "🛒", "💧", "🎯", "📝", "💡"];
const TEMPLATES: Record<string, { icon: string; fields: Array<[string, FieldType, boolean, string[]?]> }> = {
  "Food expense": {
    icon: ICONS[0],
    fields: [
      ["Item", "text", true],
      ["Amount", "money", true],
      ["Meal", "choice", false, ["Breakfast", "Lunch", "Dinner", "Snack"]],
      ["Where", "choice", false, ["Home", "Restaurant", "Canteen"]]
    ]
  },
  Books: {
    icon: ICONS[1],
    fields: [
      ["Book name", "text", true],
      ["Author", "text", false],
      ["Pages", "number", false],
      ["Rating", "rating", false],
      ["Date started", "date", false],
      ["Date finished", "date", false],
      ["Notes", "longtext", false]
    ]
  },
  Gym: {
    icon: ICONS[2],
    fields: [
      ["Exercise", "text", true],
      ["Sets", "number", false],
      ["Reps", "number", false],
      ["Weight (kg)", "number", false],
      ["Notes", "longtext", false]
    ]
  },
  LeetCode: {
    icon: ICONS[3],
    fields: [
      ["Problem", "text", true],
      ["Difficulty", "choice", true, ["Easy", "Medium", "Hard"]],
      ["Topic", "choice", false, ["Array", "String", "DP", "Graph", "Tree", "Other"]],
      ["Notes", "longtext", false]
    ]
  },
  Blank: { icon: ICONS[10], fields: [["", "text", false]] }
};

const hasValue = (value: EntryValue | undefined) => value !== undefined && value !== null && value !== "";
const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
const activeFields = (tracker: Tracker) => tracker.fields.filter((field) => !field.archived);
const parseOptions = (text = "") => Array.from(new Set(text.split(",").map((item) => item.trim()).filter(Boolean)));
const formatNumber = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const localDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function loadRemoteDb(): Promise<Db> {
  const trackers = await apiRequest<Tracker[]>("/trackers");
  const entryGroups = await Promise.all(trackers.map(async (tracker) => apiRequest<ApiEntry[]>(`/trackers/${tracker.id}/entries`)));
  return { trackers, entries: entryGroups.flat().map(({ tracker_id, ...entry }) => ({ ...entry, trackerId: tracker_id })) };
}

function dayLabel(date: Date) {
  const diff = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function showValue(field: TrackerField, value: EntryValue) {
  if (field.type === "rating" && typeof value === "number") return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
  if (field.type === "yesno") return value ? "Yes" : "No";
  if (field.type === "date") return new Date(`${String(value)}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (field.type === "money") return `₹${formatNumber(Number(value))}`;
  if (field.type === "number") return formatNumber(Number(value));
  return String(value);
}

function newDraft(): DraftTracker {
  return {
    id: null,
    name: "",
    icon: ICONS[10],
    fields: [{ label: "", type: "text", required: false, options: [], archived: false, optionsText: "" }],
    hidden: [],
    removed: [],
    error: "",
    confirmDel: false
  };
}

export default function App() {
  const [db, setDb] = useState<Db>({ trackers: [], entries: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState(Boolean(authToken));
  const [view, setView] = useState<View>("home");
  const [dashboardSection, setDashboardSection] = useState<"trackers" | "todos">("trackers");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("entries");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState<DraftTracker | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [toast, setToast] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    loadRemoteDb()
      .then(setDb)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load your trackers."))
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheet]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const tracker = currentId ? db.trackers.find((item) => item.id === currentId) : undefined;
  const liveEntries = useMemo(() => db.entries.filter((entry) => !entry.deleted), [db.entries]);
  const entriesOf = (id: string) => liveEntries.filter((entry) => entry.trackerId === id).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const openTracker = (id: string) => {
    setCurrentId(id);
    setView("tracker");
    setTab("entries");
    window.scrollTo(0, 0);
  };

  const openBuilder = () => {
    setDraft(newDraft());
    setSheet("builder");
  };

  const saveTracker = async () => {
    if (!draft) return;
    let error = "";
    if (!draft.name.trim()) error = "Give your tracker a name.";
    else if (!draft.fields.length) error = "Add at least one field.";
    else if (draft.fields.some((field) => !field.label.trim())) error = "Every field needs a name.";
    else {
      const badChoice = draft.fields.find((field) => field.type === "choice" && !parseOptions(field.optionsText).length);
      if (badChoice) error = `Add at least one option to "${badChoice.label.trim()}".`;
    }
    if (error) {
      setDraft({ ...draft, error });
      return;
    }

    const used = new Set([...draft.hidden, ...draft.removed, ...draft.fields].map((field) => field.key).filter(Boolean));
    const fields = draft.fields.map((field) => {
      let key = field.key;
      if (!key) {
        const base = slug(field.label);
        let suffix = 2;
        key = base;
        while (used.has(key)) key = `${base}_${suffix++}`;
        used.add(key);
      }
      return {
        key,
        label: field.label.trim(),
        type: field.type,
        required: field.required,
        options: field.type === "choice" ? parseOptions(field.optionsText) : [],
        archived: false
      };
    });
    const removed = draft.removed.map((field) => ({ ...field, archived: true }));

    const payload = {
      name: draft.name.trim(),
      icon: draft.icon,
      color: draft.id ? tracker?.color ?? COLORS[0] : COLORS[db.trackers.length % COLORS.length],
      fields: [...fields, ...draft.hidden, ...removed]
    };
    try {
      const saved = draft.id
        ? await apiRequest<Tracker>(`/trackers/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await apiRequest<Tracker>("/trackers", { method: "POST", body: JSON.stringify(payload) });
      if (draft.id) {
        setDb((prev) => ({ ...prev, trackers: prev.trackers.map((item) => (item.id === draft.id ? saved : item)) }));
      } else {
        setDb((prev) => ({ ...prev, trackers: [...prev.trackers, saved] }));
        setCurrentId(saved.id);
        setView("tracker");
        setTab("entries");
        window.scrollTo(0, 0);
      }
    } catch (error) {
      setDraft({ ...draft, error: error instanceof Error ? error.message : "Could not save tracker." });
      return;
    }
    if (draft.id) {
      setToast({ message: "Changes saved" });
    } else {
      setToast({ message: "Tracker created. Tap Add entry to log something." });
    }
    setDraft(null);
    setSheet(null);
  };

  const saveEntry = async () => {
    if (!tracker || !entryDraft) return;
    const missing = activeFields(tracker).find((field) => field.required && !hasValue(entryDraft.data[field.key ?? ""]));
    if (missing) {
      setEntryDraft({ ...entryDraft, error: `Fill in "${missing.label}".` });
      return;
    }
    if (!entryDraft.at) {
      setEntryDraft({ ...entryDraft, error: "Pick a date and time." });
      return;
    }
    const data: Record<string, EntryValue> = {};
    activeFields(tracker).forEach((field) => {
      const key = field.key ?? "";
      const value = entryDraft.data[key];
      if (!hasValue(value)) return;
      data[key] = field.type === "number" || field.type === "money" ? Number(value) : value;
    });
    try {
      const saved = await apiRequest<ApiEntry>(`/trackers/${tracker.id}/entries`, {
        method: "POST",
        body: JSON.stringify({ at: new Date(entryDraft.at).toISOString(), data })
      });
      const { tracker_id, ...entry } = saved;
      setDb((prev) => ({ ...prev, entries: [...prev.entries, { ...entry, trackerId: tracker_id }] }));
    } catch (error) {
      setEntryDraft({ ...entryDraft, error: error instanceof Error ? error.message : "Could not save entry." });
      return;
    }
    setEntryDraft(null);
    setSheet(null);
    setToast({ message: "Entry saved" });
  };

  const homeSummary = () => {
    const today = new Date();
    const todays = liveEntries.filter((entry) => sameDay(new Date(entry.at), today));
    const spent = todays.reduce((sum, entry) => {
      const item = db.trackers.find((candidate) => candidate.id === entry.trackerId);
      const money = item ? activeFields(item).find((field) => field.type === "money") : undefined;
      return sum + (money ? Number(entry.data[money.key ?? ""]) || 0 : 0);
    }, 0);
    if (!todays.length) return "Nothing logged today yet.";
    return `${todays.length} ${todays.length === 1 ? "entry" : "entries"} today${spent ? `, ₹${formatNumber(spent)} spent` : ""}`;
  };

  if (!session) return <AuthScreen />;
  if (loading) return <main className="wrap"><div className="empty">Loading your trackers...</div></main>;
  if (loadError) return <main className="wrap"><div className="empty">{loadError}</div></main>;

  const handleSignOut = () => {
    authToken = "";
    localStorage.removeItem(TOKEN_KEY);
    setSession(false);
  };

  return (
    <>
      <main className="wrap">
        {view === "home" || !tracker ? (
          dashboardSection === "trackers" ? (
            <Home trackers={db.trackers} entriesOf={entriesOf} onOpen={openTracker} onNew={openBuilder} onSignOut={handleSignOut} />
          ) : (
            <TodoList onSignOut={handleSignOut} />
          )
        ) : (
          <TrackerPage
            tracker={tracker}
            entries={entriesOf(tracker.id)}
            tab={tab}
            onBack={() => {
              setView("home");
              setCurrentId(null);
            }}
            onTab={setTab}
            onEdit={() => {
              setDraft({
                id: tracker.id,
                name: tracker.name,
                icon: tracker.icon,
                fields: activeFields(tracker).map((field) => ({ ...field, optionsText: field.options.join(", ") })),
                hidden: tracker.fields.filter((field) => field.archived),
                removed: [],
                error: "",
                confirmDel: false
              });
              setSheet("builder");
            }}
            onDeleteEntry={async (entry) => {
              try {
                await apiRequest<void>(`/entries/${entry.id}`, { method: "DELETE" });
                setDb((prev) => ({ ...prev, entries: prev.entries.filter((item) => item.id !== entry.id) }));
                setToast({ message: "Entry deleted" });
              } catch (error) {
                setToast({ message: error instanceof Error ? error.message : "Could not delete entry." });
              }
            }}
          />
        )}
      </main>

      {view === "tracker" && tracker && (
        <div className="fabwrap">
          <div className="fabin">
            <button
              className="fab"
              type="button"
              onClick={() => {
                setEntryDraft({ at: localDateTime(new Date()), data: {}, error: "" });
                setSheet("entry");
              }}
            >
              <span className="p" aria-hidden="true">+</span>
              Add entry
            </button>
          </div>
        </div>
      )}

      <nav className="bottom-nav-bar" aria-label="Dashboard Section Navigation">
        <div className="bottom-nav-inner">
          <button
            type="button"
            className="bottom-nav-item"
            aria-selected={view === "home" && dashboardSection === "trackers"}
            onClick={() => { setView("home"); setCurrentId(null); setDashboardSection("trackers"); }}
          >
            <span className="nav-icon">📊</span>
            <span>Trackers</span>
          </button>
          <button
            type="button"
            className="bottom-nav-item"
            aria-selected={view === "home" && dashboardSection === "todos"}
            onClick={() => { setView("home"); setCurrentId(null); setDashboardSection("todos"); }}
          >
            <span className="nav-icon">✅</span>
            <span>To-Do List</span>
          </button>
        </div>
      </nav>

      {sheet && (
        <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            {sheet === "builder" && draft ? (
              <BuilderSheet
                draft={draft}
                onDraft={setDraft}
                onClose={() => setSheet(null)}
                onSave={saveTracker}
                onDelete={async () => {
                  if (!draft.id) return;
                  if (!draft.confirmDel) {
                    setDraft({ ...draft, confirmDel: true });
                    return;
                  }
                  const id = draft.id;
                  try {
                    await apiRequest<void>(`/trackers/${id}`, { method: "DELETE" });
                  } catch (error) {
                    setDraft({ ...draft, error: error instanceof Error ? error.message : "Could not delete tracker." });
                    return;
                  }
                  setDb((prev) => ({ trackers: prev.trackers.filter((item) => item.id !== id), entries: prev.entries.filter((entry) => entry.trackerId !== id) }));
                  setSheet(null);
                  setDraft(null);
                  setView("home");
                  setCurrentId(null);
                  setToast({ message: "Tracker deleted" });
                }}
              />
            ) : null}
            {sheet === "entry" && tracker && entryDraft ? (
              <EntrySheet tracker={tracker} draft={entryDraft} onDraft={setEntryDraft} onClose={() => setSheet(null)} onSave={saveEntry} />
            ) : null}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      setError("Use 3-30 lowercase letters, numbers, or underscores.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ access_token: string }>(`/auth/${mode === "sign-in" ? "signin" : "signup"}`, {
        method: "POST",
        body: JSON.stringify({ username: normalizedUsername, password })
      });
      authToken = result.access_token;
      localStorage.setItem(TOKEN_KEY, authToken);
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed.");
    }
    setBusy(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="logo-icon">📊</div>
          <h2>My Trackers</h2>
        </div>
        <h1 className="auth-title">{mode === "sign-in" ? "Welcome back" : "Create an account"}</h1>
        <p className="auth-sub">{mode === "sign-in" ? "Sign in to access your personal trackers" : "Start tracking habits, finances, and goals"}</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              type="text"
              value={username}
              placeholder="e.g. alex"
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_]+"
              autoCapitalize="none"
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="err" role="alert">{error}</p> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="auth-switch">
          <span>{mode === "sign-in" ? "Don't have an account?" : "Already have an account?"}</span>
          <button className="auth-switch-btn" type="button" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); }}>
            {mode === "sign-in" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

type StatKey = "total_spent" | "total_entries" | "avg_per_entry" | "max_single" | "min_single" | "breakdown" | "streak" | "chart";

const DEFAULT_STATS_CONFIG: Record<StatKey, boolean> = {
  total_spent: true,
  total_entries: true,
  avg_per_entry: false,
  max_single: false,
  min_single: false,
  breakdown: true,
  streak: false,
  chart: false,
};

function Home({ trackers, entriesOf, onOpen, onNew, onSignOut }: {
  trackers: Tracker[];
  entriesOf: (id: string) => Entry[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onSignOut: () => void;
}) {
  const [rangeMode, setRangeMode] = useState<"today" | "custom">("today");
  const todayStr = localDateTime(new Date()).slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const allEntries = useMemo(() => trackers.flatMap((t) => entriesOf(t.id)), [trackers, entriesOf]);

  const filteredEntries = useMemo(() => {
    if (rangeMode === "today") {
      const today = startOfDay(new Date());
      return allEntries.filter((e) => sameDay(new Date(e.at), today));
    } else {
      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59`);
      return allEntries.filter((e) => {
        const d = new Date(e.at);
        return d >= start && d <= end;
      });
    }
  }, [allEntries, rangeMode, startDate, endDate]);

  const totalSpent = useMemo(() => {
    return filteredEntries.reduce((sum, entry) => {
      const tracker = trackers.find((t) => t.id === entry.trackerId);
      const moneyField = tracker ? activeFields(tracker).find((f) => f.type === "money") : undefined;
      return sum + (moneyField ? Number(entry.data[moneyField.key ?? ""]) || 0 : 0);
    }, 0);
  }, [filteredEntries, trackers]);

  return (
    <>
      <nav className="top-nav">
        <div className="brand-title">
          <div className="logo">📊</div>
          <h1>My Trackers</h1>
        </div>
        <div className="nav-actions">
          <button className="link" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>

      <div className="dashboard-header">
        <div className="summary-info">
          <h2>Overview</h2>
          <p>
            {rangeMode === "today" ? (
              <><strong>Today's Spent:</strong> ₹{formatNumber(totalSpent)} <small>({filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"} logged today)</small></>
            ) : (
              <><strong>Range Spent ({startDate} to {endDate}):</strong> ₹{formatNumber(totalSpent)} <small>({filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"})</small></>
            )}
          </p>
        </div>
        <div className="overview-filter">
          <div className="filter-toggle" role="tablist">
            <button type="button" aria-selected={rangeMode === "today"} onClick={() => setRangeMode("today")}>Today</button>
            <button type="button" aria-selected={rangeMode === "custom"} onClick={() => setRangeMode("custom")}>Custom Range</button>
          </div>
          {rangeMode === "custom" && (
            <div className="custom-range-inputs">
              <label>From: <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
              <label>To: <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
            </div>
          )}
        </div>
      </div>

      {!trackers.length ? (
        <div className="empty">No trackers created yet. Click <strong>+ New tracker</strong> below to get started.</div>
      ) : null}

      <div className="grid">
        {trackers.map((tracker) => (
          <button className="tile" style={{ "--c": tracker.color } as React.CSSProperties} type="button" key={tracker.id} onClick={() => onOpen(tracker.id)}>
            <div className="tile-header">
              <span className="ic">{tracker.icon}</span>
            </div>
            <div className="tile-content">
              <b>{tracker.name}</b>
            </div>
          </button>
        ))}
        <button className="tile new" type="button" onClick={onNew}>
          <span className="plus">+</span>
          <span>New tracker</span>
        </button>
      </div>
      <p className="foot">Protected by secure authentication & persistent database storage.</p>
    </>
  );
}

function TrackerPage({ tracker, entries, tab, onBack, onTab, onEdit, onDeleteEntry }: {
  tracker: Tracker;
  entries: Entry[];
  tab: Tab;
  onBack: () => void;
  onTab: (tab: Tab) => void;
  onEdit: () => void;
  onDeleteEntry: (entry: Entry) => void;
}) {
  return (
    <div style={{ "--c": tracker.color } as React.CSSProperties}>
      <button className="back" type="button" onClick={onBack}>‹ All trackers</button>
      <div className="thead">
        <span className="ic">{tracker.icon}</span>
        <div>
          <h1>{tracker.name}</h1>
          <p>{activeFields(tracker).map((field) => field.label).join(", ")}</p>
        </div>
        <button className="ghost" type="button" onClick={onEdit}>Edit fields</button>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "entries"} onClick={() => onTab("entries")}>Entries</button>
        <button type="button" role="tab" aria-selected={tab === "stats"} onClick={() => onTab("stats")}>Stats</button>
      </div>
      {tab === "entries" ? <EntriesList tracker={tracker} entries={entries} onDelete={onDeleteEntry} /> : <Stats tracker={tracker} entries={entries} />}
    </div>
  );
}

function EntriesList({ tracker, entries, onDelete }: { tracker: Tracker; entries: Entry[]; onDelete: (entry: Entry) => void }) {
  if (!entries.length) return <div className="empty">No entries yet. Tap Add entry to log your first one.</div>;
  let last = "";
  return (
    <div className="entries-compact-list">
      {entries.map((entry) => {
        const label = dayLabel(new Date(entry.at));
        const showDay = label !== last;
        last = label;
        return (
          <div key={entry.id}>
            {showDay ? <div className="day">{label}</div> : null}
            <EntryCard tracker={tracker} entry={entry} onDelete={() => onDelete(entry)} />
          </div>
        );
      })}
    </div>
  );
}

function EntryCard({ tracker, entry, onDelete }: { tracker: Tracker; entry: Entry; onDelete: () => void }) {
  const fields = activeFields(tracker);
  const title = fields.find((field) => field.type === "text") ?? fields[0];
  const highlight = fields.find((field) => field.type === "money");
  const others = fields.filter((field) => field !== title && field !== highlight);
  const titleValue = title && hasValue(entry.data[title.key ?? ""]) ? String(entry.data[title.key ?? ""]) : "Entry";
  return (
    <div className="entry compact">
      <div className="row">
        <span className="ttl">{titleValue}</span>
        {highlight && highlight !== title && hasValue(entry.data[highlight.key ?? ""]) ? <span className="hi">{showValue(highlight, entry.data[highlight.key ?? ""])}</span> : null}
      </div>
      <div className="pills">
        {others.filter((field) => field.type !== "longtext" && hasValue(entry.data[field.key ?? ""])).map((field) => (
          <span className="pill" key={field.key}>
            <i>{field.label}</i>{showValue(field, entry.data[field.key ?? ""])}
          </span>
        ))}
      </div>
      {others.filter((field) => field.type === "longtext" && hasValue(entry.data[field.key ?? ""])).map((field) => <p className="note" key={field.key}>{String(entry.data[field.key ?? ""])}</p>)}
      <div className="meta">
        <span>{new Date(entry.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
        <button type="button" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

type TodoItem = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
};

function TodoList({ onSignOut }: { onSignOut: () => void }) {
  const [todos, setTodos] = useState<TodoItem[]>(() => {
    try {
      const saved = localStorage.getItem("my-trackers-todos-list");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  useEffect(() => {
    localStorage.setItem("my-trackers-todos-list", JSON.stringify(todos));
  }, [todos]);

  const addTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const newItem: TodoItem = {
      id: String(Date.now()),
      text: input.trim(),
      completed: false,
      createdAt: new Date().toISOString()
    };
    setTodos([newItem, ...todos]);
    setInput("");
  };

  const toggleTodo = (id: string) => {
    setTodos(todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter((t) => t.id !== id));
  };

  const startEdit = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = (id: string) => {
    if (editText.trim()) {
      setTodos(todos.map((t) => (t.id === id ? { ...t, text: editText.trim() } : t)));
    }
    setEditingId(null);
  };

  const filteredTodos = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;

  return (
    <div className="todo-container">
      <nav className="top-nav">
        <div className="brand-title">
          <div className="logo">✅</div>
          <h1>To-Do List</h1>
        </div>
        <div className="nav-actions">
          <button className="link" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>

      <div className="todo-header">
        <div>
          <h2>My Tasks</h2>
          <p>{activeCount} task{activeCount === 1 ? "" : "s"} remaining</p>
        </div>
        <div className="filter-toggle">
          <button type="button" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All</button>
          <button type="button" aria-selected={filter === "active"} onClick={() => setFilter("active")}>Active</button>
          <button type="button" aria-selected={filter === "completed"} onClick={() => setFilter("completed")}>Completed</button>
        </div>
      </div>

      <form className="todo-form" onSubmit={addTodo}>
        <input
          type="text"
          value={input}
          placeholder="Add a new task (e.g. Buy groceries, Review PR)..."
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="primary" type="submit" style={{ width: "auto", margin: 0, padding: "10px 18px" }}>Add Task</button>
      </form>

      {!filteredTodos.length ? (
        <div className="empty">No tasks found. Add a task above to keep track of your work!</div>
      ) : (
        <div className="todo-list">
          {filteredTodos.map((todo) => (
            <div className={`todo-item ${todo.completed ? "completed" : ""}`} key={todo.id}>
              <div className="todo-left">
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                {editingId === todo.id ? (
                  <input
                    type="text"
                    className="todo-edit-input"
                    value={editText}
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => saveEdit(todo.id)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(todo.id)}
                  />
                ) : (
                  <span className="todo-text" onDoubleClick={() => startEdit(todo)}>{todo.text}</span>
                )}
              </div>
              <div className="todo-actions">
                {editingId === todo.id ? (
                  <button type="button" onClick={() => saveEdit(todo.id)}>Save</button>
                ) : (
                  <button type="button" onClick={() => startEdit(todo)}>Edit</button>
                )}
                <button type="button" className="del" onClick={() => deleteTodo(todo.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stats({ tracker, entries }: { tracker: Tracker; entries: Entry[] }) {
  const configKey = `my-trackers-stats-config-${tracker.id}`;
  const [statsConfig, setStatsConfig] = useState<Record<StatKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem(configKey);
      return saved ? JSON.parse(saved) : DEFAULT_STATS_CONFIG;
    } catch {
      return DEFAULT_STATS_CONFIG;
    }
  });
  const [showConfigModal, setShowConfigModal] = useState(false);

  const saveConfig = (newConfig: Record<StatKey, boolean>) => {
    setStatsConfig(newConfig);
    localStorage.setItem(configKey, JSON.stringify(newConfig));
    setShowConfigModal(false);
  };

  if (!entries.length) return (
    <>
      <div className="stats-header-bar">
        <h3>Statistics</h3>
        <button className="ghost" type="button" onClick={() => setShowConfigModal(true)}>⚙️ Customize Stats</button>
      </div>
      <div className="empty">Stats appear here once you add entries.</div>
      {showConfigModal && <CustomizeStatsModal config={statsConfig} onSave={saveConfig} onClose={() => setShowConfigModal(false)} />}
    </>
  );

  const moneyField = activeFields(tracker).find((field) => field.type === "money");
  const numeric = moneyField ?? activeFields(tracker).find((field) => field.type === "number");
  const now = new Date();
  const from7 = startOfDay(addDays(now, -6));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const in7 = entries.filter((entry) => new Date(entry.at) >= from7);
  const inMonth = entries.filter((entry) => new Date(entry.at) >= monthStart);

  const value = (entry: Entry) => numeric ? Number(entry.data[numeric.key ?? ""]) || 0 : 1;
  const numericValues = entries.map(value).filter((v) => !isNaN(v));
  const sum = (items: Entry[]) => items.reduce((total, entry) => total + value(entry), 0);
  const format = (valueToFormat: number) => numeric ? showValue(numeric, valueToFormat) : formatNumber(valueToFormat);

  const maxVal = numericValues.length ? Math.max(...numericValues) : 0;
  const minVal = numericValues.length ? Math.min(...numericValues) : 0;
  const avgVal = numericValues.length ? sum(entries) / entries.length : 0;

  const days = Object.fromEntries(entries.map((entry) => [startOfDay(new Date(entry.at)).getTime(), true]));
  let cursor = startOfDay(new Date());
  if (!days[cursor.getTime()]) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days[cursor.getTime()]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const bars = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(from7, index);
    return { date, value: sum(entries.filter((entry) => sameDay(new Date(entry.at), date))) };
  });
  const maxChartBar = Math.max(1, ...bars.map((bar) => bar.value));
  const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

  const choice = activeFields(tracker).find((field) => field.type === "choice");
  const breakdown = choice
    ? Object.entries(entries.reduce<Record<string, number>>((memo, entry) => {
        const key = String(entry.data[choice.key ?? ""] ?? "");
        if (key) memo[key] = (memo[key] ?? 0) + value(entry);
        return memo;
      }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];
  const maxBreakdown = Math.max(1, ...breakdown.map(([, itemValue]) => itemValue));

  return (
    <>
      <div className="stats-header-bar">
        <h3>Statistics</h3>
        <button className="ghost" type="button" onClick={() => setShowConfigModal(true)}>⚙️ Customize Stats</button>
      </div>

      <div className="cards">
        {statsConfig.total_entries && (
          <>
            <div className="stat"><b>{in7.length}</b><span>Entries, last 7 days</span></div>
            <div className="stat"><b>{inMonth.length}</b><span>Entries this month</span></div>
            <div className="stat"><b>{entries.length}</b><span>Total entries</span></div>
          </>
        )}
        {numeric && statsConfig.total_spent && (
          <>
            <div className="stat"><b>{format(sum(in7))}</b><span>{numeric.label}, last 7 days</span></div>
            <div className="stat"><b>{format(sum(inMonth))}</b><span>{numeric.label} this month</span></div>
            <div className="stat"><b>{format(sum(entries))}</b><span>Total {numeric.label.toLowerCase()}</span></div>
          </>
        )}
        {numeric && statsConfig.avg_per_entry && (
          <div className="stat"><b>{format(avgVal)}</b><span>Average {numeric.label.toLowerCase()} per entry</span></div>
        )}
        {numeric && statsConfig.max_single && (
          <div className="stat"><b>{format(maxVal)}</b><span>Highest single {numeric.label.toLowerCase()}</span></div>
        )}
        {numeric && statsConfig.min_single && (
          <div className="stat"><b>{format(minVal)}</b><span>Lowest single {numeric.label.toLowerCase()}</span></div>
        )}
        {statsConfig.streak && (
          <div className="stat"><b>{streak} {streak === 1 ? "day" : "days"}</b><span>Logging streak</span></div>
        )}
      </div>

      {statsConfig.chart && (
        <div className="panel">
          <h3>{numeric ? `${numeric.label} per day` : "Entries per day"}</h3>
          <div className="chart">
            {bars.map((bar) => (
              <div className="col" key={bar.date.toISOString()}>
                <span className="val">{bar.value ? compact.format(bar.value) : ""}</span>
                <div className="track"><div className="bar" style={{ height: `${Math.round((bar.value / maxChartBar) * 100)}%` }} /></div>
                <span className="dow">{bar.date.toLocaleDateString("en-IN", { weekday: "narrow" })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {statsConfig.breakdown && choice && breakdown.length ? (
        <div className="panel">
          <h3>{numeric ? `${numeric.label} by ` : "Entries by "}{choice.label.toLowerCase()}</h3>
          {breakdown.map(([label, itemValue]) => (
            <div className="hb" key={label}>
              <span className="lbl">{label}</span>
              <div className="t"><div style={{ width: `${Math.round((itemValue / maxBreakdown) * 100)}%` }} /></div>
              <b>{format(itemValue)}</b>
            </div>
          ))}
        </div>
      ) : null}

      {showConfigModal && <CustomizeStatsModal config={statsConfig} onSave={saveConfig} onClose={() => setShowConfigModal(false)} />}
    </>
  );
}

function CustomizeStatsModal({ config, onSave, onClose }: {
  config: Record<StatKey, boolean>;
  onSave: (newConfig: Record<StatKey, boolean>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...config });

  const toggle = (key: StatKey) => setDraft((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="shead">
          <h2>⚙️ Customize Stats Display</h2>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="sub">Select which metrics you want displayed on this tracker:</p>
        <div className="config-checklist">
          <label className="config-item">
            <input type="checkbox" checked={draft.total_spent} onChange={() => toggle("total_spent")} />
            <span>Total Spent / Amount Cards</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.total_entries} onChange={() => toggle("total_entries")} />
            <span>Total Entry Count Cards</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.avg_per_entry} onChange={() => toggle("avg_per_entry")} />
            <span>Average Amount Per Entry</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.max_single} onChange={() => toggle("max_single")} />
            <span>Highest Single Entry Value</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.min_single} onChange={() => toggle("min_single")} />
            <span>Lowest Single Entry Value</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.breakdown} onChange={() => toggle("breakdown")} />
            <span>Category / Choice Breakdown</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.streak} onChange={() => toggle("streak")} />
            <span>Logging Streak</span>
          </label>
          <label className="config-item">
            <input type="checkbox" checked={draft.chart} onChange={() => toggle("chart")} />
            <span>Daily Trend Bar Chart</span>
          </label>
        </div>
        <button className="primary" type="button" onClick={() => onSave(draft)}>Save Preferences</button>
      </div>
    </div>
  );
}

function BuilderSheet({ draft, onDraft, onClose, onSave, onDelete }: {
  draft: DraftTracker;
  onDraft: (draft: DraftTracker) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const updateField = (index: number, patch: Partial<TrackerField>) => {
    onDraft({ ...draft, fields: draft.fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)) });
  };
  return (
    <>
      <div className="shead"><h2>{draft.id ? "Edit fields" : "New tracker"}</h2><button className="ghost" type="button" onClick={onClose}>Close</button></div>
      {!draft.id ? (
        <>
          <span className="lab">Start from a template<small>or build your own below</small></span>
          <div className="chips">
            {Object.entries(TEMPLATES).map(([name, template]) => (
              <button
                className="chip"
                type="button"
                key={name}
                onClick={() => onDraft({
                  ...draft,
                  name: name === "Blank" ? draft.name : name,
                  icon: template.icon,
                  fields: template.fields.map((field) => ({ label: field[0], type: field[1], required: field[2], options: field[3] ?? [], archived: false, optionsText: (field[3] ?? []).join(", ") })),
                  error: ""
                })}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <label className="lab" htmlFor="tracker-name">Tracker name</label>
      <input id="tracker-name" value={draft.name} placeholder="e.g. Food expense" autoComplete="off" onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
      <span className="lab">Icon</span>
      <div className="chips">
        {ICONS.map((icon) => <button className="chip ico" type="button" aria-pressed={draft.icon === icon} key={icon} onClick={() => onDraft({ ...draft, icon })}>{icon}</button>)}
      </div>
      <span className="lab">Fields<small>what you want to record each time</small></span>
      {draft.fields.map((field, index) => (
        <div className="frow" key={`${field.key ?? "new"}-${index}`}>
          <input value={field.label} placeholder="Field name, e.g. Amount" aria-label="Field name" autoComplete="off" onChange={(event) => updateField(index, { label: event.target.value })} />
          <div className="fmeta">
            <select value={field.type} aria-label="Field type" onChange={(event) => updateField(index, { type: event.target.value as FieldType })}>
              {TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <label className="chk"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /> Required</label>
            <button
              className="ghost danger"
              type="button"
              onClick={() => onDraft({ ...draft, fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index), removed: field.key ? [...draft.removed, field] : draft.removed })}
            >
              Remove
            </button>
          </div>
          {field.type === "choice" ? <input value={field.optionsText ?? ""} placeholder="Options, separated by commas" aria-label="Options" onChange={(event) => updateField(index, { optionsText: event.target.value })} /> : null}
        </div>
      ))}
      <button className="chip add" type="button" onClick={() => onDraft({ ...draft, fields: [...draft.fields, { label: "", type: "text", required: false, options: [], archived: false, optionsText: "" }] })}>+ Add field</button>
      {draft.id ? <p className="hint">Removing a field hides it. Old entries keep their data.</p> : null}
      {draft.error ? <p className="err" role="alert">{draft.error}</p> : null}
      <button className="primary" type="button" onClick={onSave}>{draft.id ? "Save changes" : "Create tracker"}</button>
      {draft.id ? <button className="ghost danger full" type="button" onClick={onDelete}>{draft.confirmDel ? "Tap again to delete this tracker and its entries" : "Delete tracker"}</button> : null}
    </>
  );
}

function EntrySheet({ tracker, draft, onDraft, onClose, onSave }: {
  tracker: Tracker;
  draft: EntryDraft;
  onDraft: (draft: EntryDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const setValue = (key: string, value: EntryValue) => onDraft({ ...draft, data: { ...draft.data, [key]: value } });
  return (
    <>
      <div className="shead"><h2>{tracker.icon} Add to {tracker.name}</h2><button className="ghost" type="button" onClick={onClose}>Close</button></div>
      <label className="lab" htmlFor="entry-when">When</label>
      <input id="entry-when" type="datetime-local" value={draft.at} onChange={(event) => onDraft({ ...draft, at: event.target.value })} />
      {activeFields(tracker).map((field) => {
        const key = field.key ?? "";
        const value = draft.data[key];
        return (
          <div key={key}>
            <span className="lab">{field.label}{field.required ? <small>Required</small> : null}</span>
            {field.type === "longtext" ? <textarea value={String(value ?? "")} onChange={(event) => setValue(key, event.target.value)} /> : null}
            {field.type === "number" || field.type === "money" ? <input type="number" inputMode="decimal" step="any" value={String(value ?? "")} placeholder={field.type === "money" ? "₹ 0" : "0"} onChange={(event) => setValue(key, event.target.value)} /> : null}
            {field.type === "date" ? <input type="date" value={String(value ?? "")} onChange={(event) => setValue(key, event.target.value)} /> : null}
            {field.type === "choice" ? (
              <div className="chips">
                {field.options.map((option) => <button className="chip" type="button" aria-pressed={value === option} key={option} onClick={() => setValue(key, value === option ? "" : option)}>{option}</button>)}
              </div>
            ) : null}
            {field.type === "yesno" ? (
              <div className="chips">
                <button className="chip" type="button" aria-pressed={value === true} onClick={() => setValue(key, true)}>Yes</button>
                <button className="chip" type="button" aria-pressed={value === false} onClick={() => setValue(key, false)}>No</button>
              </div>
            ) : null}
            {field.type === "rating" ? (
              <div className="stars">
                {[1, 2, 3, 4, 5].map((rating) => <button className={Number(value) >= rating ? "on" : ""} type="button" key={rating} onClick={() => setValue(key, value === rating ? "" : rating)}>★</button>)}
              </div>
            ) : null}
            {field.type === "text" ? <input value={String(value ?? "")} autoComplete="off" onChange={(event) => setValue(key, event.target.value)} /> : null}
          </div>
        );
      })}
      {draft.error ? <p className="err" role="alert">{draft.error}</p> : null}
      <button className="primary" type="button" onClick={onSave}>Save entry</button>
    </>
  );
}
