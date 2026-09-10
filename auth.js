// Optional account layer for Sinking Funds. Loaded as a <script type="module">
// on index.html. Exposes window.CloudSync so the existing non-module script
// can call it like any other global -- the same idiom it already uses for
// everything else in the file.
//
// Local-file-mode usage must never depend on this file loading or working --
// every consumer should treat window.CloudSync as possibly unconfigured, and
// signed-out behavior must render identically whether or not it is. Signing
// in is an opt-in enhancement layer, not a gate -- see CLAUDE.md's "Google
// login + database" section.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// From the sinking-funds Supabase project's Settings -> API page. The
// publishable key (Supabase's newer name for the "anon key") is safe to
// expose client-side by design -- it has no power on its own; Row Level
// Security in the database (db/schema.sql) is what actually gates access to
// each user's own rows.
const SUPABASE_URL = "https://iqqopimujgczavqchhph.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HNT29a7sMtznV2xK6Xop_A_q3FJ4_Ah";

const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

if (!configured) {
  console.warn("[CloudSync] Not configured -- set SUPABASE_URL/SUPABASE_ANON_KEY in auth.js. Sign-in is disabled; local file mode works normally.");
}

const listeners = [];
let currentSession = null;

function notify() {
  for (const cb of listeners) cb(currentSession);
}

async function init() {
  if (!configured) return;
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  notify();
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    notify();
  });
}

async function signInWithGoogle() {
  if (!configured) {
    console.warn("[CloudSync] Sign-in unavailable: Supabase not configured.");
    return;
  }
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

async function signOut() {
  if (!configured) return;
  await supabase.auth.signOut();
}

// Registers a callback for session changes, and fires it immediately with
// whatever's currently known (possibly null) so late-registering consumers
// don't have to separately ask for the initial state.
function onAuthChange(cb) {
  listeners.push(cb);
  cb(currentSession);
}

function getSession() {
  return currentSession;
}

function isSignedIn() {
  return Boolean(currentSession);
}

/**
 * PostgREST has a known, currently-open bug (a stale timestamp cache in its
 * JWT validator, https://github.com/orgs/supabase/discussions/48123) that
 * can reject a freshly-minted token moments after sign-in with PGRST303
 * "JWT issued at future" -- confirmed not a real clock problem on either
 * side, and it clears up within seconds on its own. Retry a couple of times
 * with a short delay rather than let one transient rejection, right at the
 * exact moment a user just signed in, block the whole cloud load.
 */
async function withRetry(queryFn, attempts = 6, delayMs = 6000) {
  let res;
  for (let i = 0; i < attempts; i++) {
    res = await queryFn();
    if (!res.error || res.error.code !== "PGRST303" || i === attempts - 1) return res;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return res;
}

/**
 * Fetches every table for the signed-in user and reshapes the rows back into
 * the app's own funds.json-style nested shape -- the inverse of db/schema.sql's
 * mapping. RLS already scopes every query to auth.uid(), so there's no need
 * to filter by user id here. Returns null (rather than an empty-but-valid
 * state) when there are no categories yet, so the caller can tell "nothing
 * synced" apart from "a genuinely empty budget" and leave whatever's
 * currently loaded alone instead of blanking it out.
 */
async function fetchAppState() {
  if (!configured || !currentSession) return null;

  const [categories, funds, fundBudgets, ledger, cashReadings, cardReadings, plans, incomes, oneOffs, settings] =
    await Promise.all([
      withRetry(() => supabase.from("categories").select("*")),
      withRetry(() => supabase.from("funds").select("*")),
      withRetry(() => supabase.from("fund_budgets").select("*")),
      withRetry(() => supabase.from("ledger").select("*")),
      withRetry(() => supabase.from("cash_readings").select("*")),
      withRetry(() => supabase.from("card_readings").select("*")),
      withRetry(() => supabase.from("plans").select("*")),
      withRetry(() => supabase.from("incomes").select("*")),
      withRetry(() => supabase.from("one_offs").select("*")),
      withRetry(() => supabase.from("settings").select("*").maybeSingle()),
    ]);

  for (const [name, res] of Object.entries({ categories, funds, fundBudgets, ledger, cashReadings, cardReadings, plans, incomes, oneOffs, settings })) {
    if (res.error) console.error(`[CloudSync] fetching ${name} failed:`, res.error.message);
  }
  if (categories.error || !categories.data?.length) return null;

  const budgetsByFund = {};
  for (const b of fundBudgets.data || []) {
    (budgetsByFund[b.fund_id] || (budgetsByFund[b.fund_id] = [])).push({ from: b.from_month, amount: Number(b.amount) });
  }

  return {
    meta: {
      planStart: settings.data?.plan_start || null,
      incomes: (incomes.data || []).map(i => ({ from: i.from_month, amount: Number(i.amount) })),
      oneOffs: (oneOffs.data || []).map(o => ({ id: o.id, month: o.month, amount: Number(o.amount), note: o.note || "" })),
      deleted: [],   // no tombstones in the cloud schema; a DELETE is just gone
    },
    cashReadings: (cashReadings.data || []).map(r => ({ id: r.id, date: r.date, amount: Number(r.amount), note: r.note || "" })),
    cardReadings: (cardReadings.data || []).map(r => ({ id: r.id, date: r.date, amount: Number(r.amount), note: r.note || "" })),
    categories: categories.data.map(c => ({
      id: c.id, name: c.name, icon: c.icon, color: c.color, note: c.note || "",
      createdAt: c.created_at, archivedAt: c.archived_at,
    })),
    funds: (funds.data || []).map(f => ({
      id: f.id, categoryId: f.category_id, name: f.name,
      budgets: budgetsByFund[f.id] || [],
      target: Number(f.target) || 0, targetDate: f.target_date || "",
      schedule: f.schedule_amounts ? { amounts: f.schedule_amounts } : null,
      buffer: f.buffer, fixed: f.fixed, dueDay: f.due_day || 0,
      floor: Number(f.floor) || 0, ceiling: Number(f.ceiling) || 0,
      note: f.note || "", createdAt: f.created_at, archivedAt: f.archived_at,
    })),
    ledger: (ledger.data || []).map(e => ({
      id: e.id, fundId: e.fund_id, amount: Number(e.amount), date: e.date, note: e.note || "",
      kind: e.kind, pairId: e.pair_id, splitId: e.split_id,
      createdAt: e.created_at, updatedAt: e.updated_at,
    })),
    plans: (plans.data || []).map(p => ({
      id: p.id, fundId: p.fund_id, name: p.name, amount: Number(p.amount),
      month: p.month || "", note: p.note || "", createdAt: p.created_at, settledAt: p.settled_at,
    })),
  };
}

// Drives the main app's cloud-vs-local switch. A session appearing (whether
// a persisted one found on load, or a fresh sign-in) fetches and hands off
// the reshaped state; a session disappearing -- but only a REAL sign-out,
// not just "not signed in yet" on first load -- reloads the page, which
// sends boot() back down the ordinary local-file path. window.loadCloudState
// and window.exitCloudMode are defined in the main script (index.html), which
// is guaranteed to have already finished running by the time this fires --
// deferred modules always execute after every preceding classic script.
let wasSignedIn = false;
async function syncCloudState(session) {
  if (session) {
    wasSignedIn = true;
    const raw = await fetchAppState();
    if (raw) window.loadCloudState?.(raw);
  } else if (wasSignedIn) {
    wasSignedIn = false;
    window.exitCloudMode?.();
  }
}
onAuthChange(syncCloudState);

// Renders the sign-in/sign-out control into #account-control (in the
// header, next to the local-save sync pill). Self-contained here rather than
// in the main inline script, since module scripts resolve their imports
// asynchronously -- the inline script can't safely assume window.CloudSync
// exists yet just because it appears later in the document. Styled with the
// app's own `.sync` pill class rather than a new one, so it reads as a
// sibling of the sync button it sits beside, not a bolted-on extra.
function renderAccountControl(session) {
  const el = document.getElementById("account-control");
  if (!el) return;

  if (!configured) {
    el.innerHTML = "";
    return;
  }

  if (session) {
    const email = session.user?.email || "Account";
    el.innerHTML = `<button type="button" class="sync" id="account-signout" title="Signed in -- click to sign out">
      <span class="dot" style="background:var(--credit)"></span><span class="path">${escapeForAttr(email)}</span>
    </button>`;
    document.getElementById("account-signout").addEventListener("click", signOut);
  } else {
    el.innerHTML = `<button type="button" class="sync" id="account-signin" title="Sync your budget to your account">
      <span class="path">Sign in with Google</span>
    </button>`;
    document.getElementById("account-signin").addEventListener("click", signInWithGoogle);
  }
}

// Tiny local escape -- this module doesn't import the main script's
// escapeHtml, and an email address is the only untrusted string rendered
// here.
function escapeForAttr(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

onAuthChange(renderAccountControl);
init();

window.CloudSync = {
  signInWithGoogle,
  signOut,
  onAuthChange,
  getSession,
  isSignedIn,
  isConfigured: () => configured,
  fetchAppState,
};
