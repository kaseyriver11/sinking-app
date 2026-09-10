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
    // sort_order is what stands in for array position server-side (SQL rows
    // have no inherent order) -- sort by it here so the reshaped arrays come
    // back in the same order the local file would have had them in.
    categories: [...categories.data].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(c => ({
      id: c.id, name: c.name, icon: c.icon, color: c.color, note: c.note || "",
      createdAt: c.created_at, archivedAt: c.archived_at,
    })),
    funds: [...(funds.data || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(f => ({
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

/* ── cloud writes ────────────────────────────────────────────────────────
 * Every mutation function in the main script keeps its existing synchronous
 * local write exactly as it is -- these calls are additive, fired after the
 * local mutation, fire-and-forget. A failure here (offline, the still-open
 * PGRST303 bug, anything) is logged and left; `state` is already correct
 * locally, and a full offline write-queue is out of scope for this pass,
 * the same way DVCalc shipped without one. Every call is a no-op when not
 * configured or not signed in, so signed-out behavior never changes.
 */

function cloudRow(row) {
  return { ...row, user_id: currentSession.user.id };
}

async function cloudCall(fn) {
  if (!configured || !currentSession) return;
  try {
    const { error } = await fn();
    if (error) console.error("[CloudSync] write failed:", error.message);
  } catch (err) {
    console.error("[CloudSync] write threw:", err.message);
  }
}

// Categories/funds carry no sortOrder field locally -- order is purely
// array position in JS, so the index has to come from the caller (which has
// the array); it's read straight off state.categories/state.funds there.
function categoryRow(c, index) {
  return { id: c.id, name: c.name, icon: c.icon, color: c.color, note: c.note || "",
    sort_order: index || 0, archived_at: c.archivedAt || null, created_at: c.createdAt || null };
}
function fundRow(f, index) {
  return { id: f.id, category_id: f.categoryId, name: f.name,
    target: f.target || 0, target_date: f.targetDate || null,
    schedule_amounts: f.schedule ? f.schedule.amounts : null,
    buffer: !!f.buffer, floor: f.floor || 0, fixed: !!f.fixed, due_day: f.dueDay || 0,
    ceiling: f.ceiling || 0, note: f.note || "", sort_order: index || 0,
    archived_at: f.archivedAt || null, created_at: f.createdAt || null };
}
function ledgerRow(e) {
  return { id: e.id, fund_id: e.fundId, amount: e.amount, date: e.date, note: e.note || "",
    kind: e.kind || null, pair_id: e.pairId || null, split_id: e.splitId || null,
    created_at: e.createdAt || null, updated_at: e.updatedAt || null };
}
function readingRow(r) {
  return { id: r.id, date: r.date, amount: r.amount, note: r.note || "" };
}
function planRow(p) {
  return { id: p.id, fund_id: p.fundId, name: p.name, amount: p.amount,
    month: p.month || "", note: p.note || "", created_at: p.createdAt || null, settled_at: p.settledAt || null };
}
function oneOffRow(o) {
  return { id: o.id, month: o.month, amount: o.amount, note: o.note || "" };
}

/**
 * Any change to a category -- add, edit, archive/unarchive. `index` is this
 * category's current position in state.categories (the caller's array), the
 * stand-in for its sort order.
 */
function syncCategory(c, index) {
  return cloudCall(() => supabase.from("categories").upsert(cloudRow(categoryRow(c, index))));
}
/** After moveCategory() -- re-syncs every category's position in one call. */
function syncCategoryOrder(categories) {
  if (!categories.length) return;
  return cloudCall(() => supabase.from("categories")
    .upsert(categories.map((c, i) => cloudRow(categoryRow(c, i)))));
}
/** Cascades to its funds/ledger/fund_budgets/plans server-side (on delete cascade). */
function deleteCategoryCloud(id) {
  return cloudCall(() => supabase.from("categories").delete().eq("id", id));
}

/**
 * Any change to a fund -- add, edit, archive/unarchive, a budget or schedule
 * change. `index` is this fund's position in state.funds. Always re-syncs
 * the fund's whole budgets[] alongside it (delete-then-insert) rather than
 * trying to track which single month changed, because setBudget() can both
 * add AND collapse-remove a month in one call -- replacing the set wholesale
 * is simpler than mirroring that logic here, and budgets[] is always small.
 */
async function syncFund(f, index) {
  if (!configured || !currentSession) return;
  await cloudCall(() => supabase.from("funds").upsert(cloudRow(fundRow(f, index))));
  await cloudCall(() => supabase.from("fund_budgets").delete().eq("fund_id", f.id));
  const rows = (f.budgets || []).map(b => cloudRow({ id: `${f.id}:${b.from}`, fund_id: f.id, from_month: b.from, amount: b.amount }));
  if (rows.length) await cloudCall(() => supabase.from("fund_budgets").insert(rows));
}
/** After moveFund() -- re-syncs every fund's position in one call (budgets untouched, a reorder never changes them). */
function syncFundOrder(funds) {
  if (!funds.length) return;
  return cloudCall(() => supabase.from("funds")
    .upsert(funds.map((f, i) => cloudRow(fundRow(f, i)))));
}
/** Cascades to its ledger/fund_budgets/plans server-side. */
function deleteFundCloud(id) {
  return cloudCall(() => supabase.from("funds").delete().eq("id", id));
}

function syncLedgerEntry(e) {
  return cloudCall(() => supabase.from("ledger").upsert(cloudRow(ledgerRow(e))));
}
/** For moveMoney (2 rows) and addSplitExpense (N rows) -- one round trip. */
function syncLedgerEntries(entries) {
  if (!entries.length) return;
  return cloudCall(() => supabase.from("ledger").upsert(entries.map(e => cloudRow(ledgerRow(e)))));
}
function deleteLedgerEntry(id) {
  return cloudCall(() => supabase.from("ledger").delete().eq("id", id));
}
function deleteLedgerBy(column, value) {
  return cloudCall(() => supabase.from("ledger").delete().eq(column, value));
}

function syncCashReading(r) {
  return cloudCall(() => supabase.from("cash_readings").upsert(cloudRow(readingRow(r))));
}
function deleteCashReadingCloud(id) {
  return cloudCall(() => supabase.from("cash_readings").delete().eq("id", id));
}
function syncCardReading(r) {
  return cloudCall(() => supabase.from("card_readings").upsert(cloudRow(readingRow(r))));
}
function deleteCardReadingCloud(id) {
  return cloudCall(() => supabase.from("card_readings").delete().eq("id", id));
}

function syncPlan(p) {
  return cloudCall(() => supabase.from("plans").upsert(cloudRow(planRow(p))));
}
function deletePlanCloud(id) {
  return cloudCall(() => supabase.from("plans").delete().eq("id", id));
}

/** Whole-list replace, same reasoning as syncFund's budgets -- setIncome()
 *  can add and collapse-remove a month in one call. */
async function syncIncomes(list) {
  if (!configured || !currentSession) return;
  await cloudCall(() => supabase.from("incomes").delete().eq("user_id", currentSession.user.id));
  const rows = (list || []).map(i => cloudRow({ id: `inc:${i.from}`, from_month: i.from, amount: i.amount }));
  if (rows.length) await cloudCall(() => supabase.from("incomes").insert(rows));
}

function syncOneOff(o) {
  return cloudCall(() => supabase.from("one_offs").upsert(cloudRow(oneOffRow(o))));
}
function deleteOneOffCloud(id) {
  return cloudCall(() => supabase.from("one_offs").delete().eq("id", id));
}

function syncSettings(planStart) {
  return cloudCall(() => supabase.from("settings").upsert(cloudRow({ plan_start: planStart || null })));
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
  syncCategory,
  syncCategoryOrder,
  deleteCategoryCloud,
  syncFund,
  syncFundOrder,
  deleteFundCloud,
  syncLedgerEntry,
  syncLedgerEntries,
  deleteLedgerEntry,
  deleteLedgerBy,
  syncCashReading,
  deleteCashReadingCloud,
  syncCardReading,
  deleteCardReadingCloud,
  syncPlan,
  deletePlanCloud,
  syncIncomes,
  syncOneOff,
  deleteOneOffCloud,
  syncSettings,
};
