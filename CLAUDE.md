# 02_sinking_app

Simple personal budget app for **sinking funds** and long-term tracking. Short-term side project — **not tracked in GSD**.

## Purpose

Envelope budgeting across ~6-7 categories. Each month you credit every category its monthly budget, log expenses against it during the month, and watch the balances rise and fall over time. Deliberately simple — no bank syncing, no transaction import.

**Scope, decided explicitly (2026-08-29): local, single-user, single-machine — not a hosted product.** The question was framed as "the best budget tool for my own needs" vs. "a budget tool others could use," and the answer is the former. This rules out — for now, not necessarily forever — cloud sync, Google/any login, multi-device access, sharing with another person, and bank/credit-card integration (Plaid or similar): all of that only pays for itself once "someone else's data" or "my data on a device that isn't this one" is actually a real requirement, and today neither is. If that changes, revisit rather than assume the earlier reasoning still holds.

**Revisited (2026-09-10): multi-device access became a real requirement**, so cloud sync now exists alongside local mode rather than instead of it — Google sign-in, a Supabase Postgres backend (relational tables, one per entity, RLS-scoped to `auth.uid()`), and the app itself hosted on GitHub Pages so a signed-in session works from any device, phone included. Sign-in is additive, not a gate: local file mode (this section, and "Durability layers" below) is untouched and still works fully offline with no account. The two modes don't merge automatically — switching from a local file to a signed-in account is a one-time import (`•••` menu), not something that happens silently. See `auth.js` and `db/schema.sql` for the implementation; a full narrative writeup of this build (the phased plan, the bugs found along the way) is still owed here and hasn't been backfilled yet.

## Running it

Just open `index.html` directly in Chrome (`file://` works fine) — no server needed. Verified on Windows/Chrome: the File System Access API grants and disk writes both work over `file://`; a live edit landed in `data/funds.json` within a second. An earlier version of this doc claimed Chrome blocked the API on `file://` origins — that wasn't true here, at least on the current Chrome version, so the local-server launcher below is optional, not required.

On first run, click the pill in the header → **Choose data folder…** and pick this project folder.

**`start.command`** (macOS) / **`start.bat`** (Windows) serve the folder on `http://127.0.0.1:8756` instead of using `file://`. Neither is required just to get the app saving to disk — but Chrome only offers **Install page as app** (⋮ → Cast, save and share → Install page as app) for `http(s)` pages, not `file://`, and installing is what unlocks persistent File System Access permission across restarts (see the reconnect banner section below). So: run the launcher once to install from the `127.0.0.1` tab it opens. The installed shortcut still just points at that same `127.0.0.1:8756` URL, with no offline caching — the launcher has to be run (or already running) every time you open the app from then on, installed or not. Both scripts reuse an already-running server rather than starting a second one; close the "Sinking Funds Server" window to stop it.

**On Windows, the server auto-starts at login instead** — `serve_hidden.vbs` runs the same reuse-guarded server with no console window and no browser auto-open, launched at every login by a shortcut in the Startup folder (`shell:startup` → *Sinking Funds Server.lnk*). This means `127.0.0.1:8756` is simply always available; `start.bat` is no longer something you need to remember, though it still works for a one-off manual start (e.g. before the autostart shortcut existed, or on another Windows machine that doesn't have it set up). **`stop.bat`** kills whatever's listening on the port, however it was started — useful since the autostart version has no window to close. To remove the autostart entirely, delete the shortcut from the Startup folder.

## Data model

Two levels. A **category** groups related spending and carries the identity (icon, colour): *Utilities*. A **fund** is where money actually lives — the budget, the goal, the balance: *House Energy*, *Water*, *Internet*. A category's balance and monthly budget are the roll-up of its funds. Array order is display order for both.

Everything lives in `data/funds.json`, written by the browser via the File System Access API. Google Drive syncs it and keeps version history.

```json
{
  "schemaVersion": 10,
  "meta": { "createdAt": "…", "lastBackup": "…", "planStart": "2026-09",
            "incomes": [{ "from": "2026-01", "amount": 7400 }],
            "oneOffs": [{ "id": "…", "month": "2027-04", "amount": 3000, "note": "Tax refund" }],
            "deleted": ["<erased entry ids>"] },
  "cashReadings": [{ "id": "…", "date": "2026-08-25", "amount": 74197, "note": "" }],
  "categories": [
    { "id": "…", "name": "Utilities", "icon": "💡", "color": "yellow",
      "note": "", "createdAt": "…", "archivedAt": null }
  ],
  "funds": [
    { "id": "…", "categoryId": "…", "name": "House Energy", "monthlyAllotment": 180,
      "target": 0, "targetDate": "", "note": "", "createdAt": "…", "archivedAt": null }
  ],
  "ledger": [
    { "id": "…", "fundId": "…", "amount": 180, "date": "2026-09-01",
      "note": "September 2026", "kind": "allotment", "createdAt": "…", "updatedAt": "…" }
  ]
}
```

- Positive `amount` = credit, negative = expense. Entries attach to **funds**, never to categories.
- `kind: "allotment"` marks entries created by **Fund the month** so it can warn a month is already funded. Internal only — the word never appears in the UI.
- `target` / `targetDate` are optional, for one-off goals like "$650 by March".
- `schedule: { amounts: [12 numbers] }` marks an **irregular expense** — one slot per calendar month. See below.
- `buffer: true` marks a fund whose draws are genuinely unpredictable, with an optional `floor`. Mutually exclusive with `schedule`. See below.
- `ceiling` is optional on **every** kind of fund: drift above it and the fund offers to hand the surplus back. See below.
- `cashReadings` is a **dated series** of what the bank held (see below). **Allocated** = sum of fund balances; **Unallocated** = the difference, i.e. what would remain if every fund were spent to $0.
- `meta.oneOffs` are pencilled-in future cash movements for the forecast — `{ id, month, amount, note }`, positive in, negative out. Tombstoned on delete like ledger entries, so a removed one doesn't walk back in on the next merge.

### Needs attention

One list of everything currently wrong, worst first: overdrawn, then short for the next bill, then running dry later in the cycle, then over budget. Each row links to the fund and, where there's a single number that fixes it, offers to add it.

**Ignore is per month.** An item you've decided to live with stays quiet until the month turns, when the situation has changed and deserves a fresh look. Stored in `localStorage`, keyed by fund + issue type, so fixing a problem removes it and a *different* problem on the same fund still surfaces.

### The plan start month

`meta.planStart` is the month this budget takes effect. Anything before it — an unpaid bill, a missed contribution — belongs to the old way of doing things and is not the app's problem.

Without it, setting up a fund on 26 August meant the app demanded a buffer for August's bill, which had already been paid out of the current account. House Energy read **$630 short**; with a September start it reads **$190**, the $440 difference being exactly August's bill.

It shifts three things: `forecast()` starts its walk at `horizonStart()` rather than today, `nextDueKey()` won't chase a bill from before the plan, and `projection()` counts the plan's first month as still-to-come (unlike the current month, which is either funded or won't be). Set in the cash dialog; defaults to the month the file was created.

### Irregular expenses

Some costs aren't monthly: preschool at $200 for eight months of the year, a quarterly water bill, annual insurance. Funding them at their face amount only in the months they occur makes the fund pointless — it nets to zero every month and the lumpiness just moves to your bank account.

A fund with a `schedule` instead contributes a **level amount every month** and pays out whatever that month costs. The canonical shape is a **12-slot amounts array**, one per calendar month, which covers all three patterns with one model:

| Pattern | Example | Shape |
|---|---|---|
| Annual bill | insurance, $1,800 every December | one non-zero slot |
| Fixed, certain months | preschool, $315 × 9 months | equal non-zero slots |
| **Seasonal** | electricity, $100 in winter to $400 in July | twelve different slots |

A fourth kind isn't a schedule at all: when you can't predict the months either, that's a **buffer** — see below.

The editor offers one **Varying** type with a quick-fill helper (see below). `scheduleInfo()` exposes `amounts`, `amountFor(mk)`, and derived `months` / `uniform` views, so the older `{ amount, months }` files migrate with no loss.

Worked example — electricity totalling $2,270 a year contributes **$189.17/mo** and peaks at $563 in May before the summer drains it to $0 in September. A $400 July bill against a $189 budget is never "over budget", because a scheduled fund is judged on its curve.

`scheduleInfo()` derives everything from the amounts:

| | Preschool: $200 × 8 months |
|---|---|
| Annual cost | $1,600 |
| Level contribution | **$133.33/mo** |
| Peak balance | $533.33 (end of August) |
| Trough | $0 (end of April) |

The 12-month balance shape is fixed by the schedule, so it's simulated once and lifted until its lowest point sits at zero. That curve is then both the **target to measure against** and, read at any month, the **seed needed to start there** without going negative.

This changes how the fund is judged. A scheduled fund is *supposed* to outspend its monthly credit in a due month, so comparing the two produced a red "Over budget" badge eight months a year on a fund behaving perfectly.

**Judged on two horizons, because one wasn't enough.**

`cycleOutlook()` asks whether the fund survives the *whole* year. `expectedAt` is the steady state an irregular fund is meant to hold — preschool peaks at $708.75 after three bill-free summer months and drains to $0 by the end of May. The curve is built with its trough at zero, which gives a useful identity:

> **the gap to the curve today = exactly how far below zero the balance goes at the cycle's low point.**

Holding $490 against a $708.75 steady state means being $218.75 overdrawn in May. That is what makes "you should be holding $708.75" actionable rather than abstract, and it is why the calendar strip shows an irregular figure for every month.

Status now reports the imminent problem first, then the structural one:

| | |
|---|---|
| Can't pay the next bill | **Short for Sep** |
| Can pay it but the cycle runs dry later | **Runs out May** |
| Neither | Ready / On track |

Next-payment alone said "Ready for Sep" for a fund that goes negative in March — technically true, materially misleading. **Top up** now closes the cycle gap rather than just the next bill, which is the amount that actually stops it going negative.

**The near-term check is still shown**, as its own panel: `projection()` answers the only question that matters — *will there be enough when the bill lands?*

```
balance now  +  contributions still to come  vs  amount due
```

Two rules make that number trustworthy, both learned from getting it wrong:

- **Only months after the current one count as "to come."** The current month is either already funded (so it's in the balance) or you're about to fund it, at which point this recomputes. Counting it now promises the same money twice.
- **"Funded" means an entry tagged `kind: "allotment"`**, not any credit. Otherwise a top-up dated this month looks like the monthly contribution and silently cancels itself out — which is exactly how the original Catch-up button under-credited by one contribution.

**Banked vs projected are never conflated.** Three distinct states, because "ready" implies the money is sitting there:

| State | Pill | Meaning |
|---|---|---|
| `balance >= amount` | **Ready for Jan** | The full amount is in the fund *now* |
| `projected >= amount` | **On track for Jan** | Gets there via contributions not yet made |
| otherwise | **Short for Jan** | Won't make it without a top-up |

The earlier curve-based comparison (`expectedAt`) is still used for the 12-month strip and the dashed reference line on the chart, where it's context rather than judgement.

The fund page gets a 12-month strip showing which months are due and where the balance should stand at each month's end, the expected curve dashed over the actual balance chart, and a **Catch up** button when the balance sits below the curve.

### Status is deliberately quiet

A fund is only flagged when something is actually wrong:

| State | Flag |
|---|---|
| Balance below zero | **Overdrawn** (critical) |
| Spent more than the **monthly budget** | **Over budget** (warning) |
| Below its schedule curve | **Behind** / **Slightly behind** (warning) |
| Anything else | On track (quiet) |

There is deliberately **no "not funded yet"**. Balances roll over, so a month you haven't funded yet is not a problem — and flagging every budgeted fund on the 1st of the month was noise that trained you to ignore the pills. "Over budget" also compares spending against the **budget**, not against whatever happened to be budgeted this month, for the same reason. The overview's *Budgeted this month* tile carries the neutral "3 of 8 budgeted funds funded" line, which is the one place a nudge to run **Fund the month** belongs.

### Deleting things

| What | Where | Effect |
|---|---|---|
| A line item | Fund page → Budgeted/Expenses table → **Delete** | Row erased, id tombstoned |
| A fund | Fund page → **Edit** → **Delete** | Fund and **all its entries** erased |
| A category | Category page → **Edit category** → **Delete** | Category, **all its funds and all their entries** erased |

Every delete confirm states exactly what goes with it — fund count, entry count, and the balance at stake. **Archive** sits beside Delete in both dialogs as the non-destructive option, and archived items are restorable from the **Archived** disclosure at the foot of the rail.

### Edit and delete are real

`editEntry` mutates the row in place (stamping `updatedAt`); `deleteEntry` removes it. There is no in-app trash. The safety net is the daily snapshot in `data/backups/` plus Drive version history.

Deleted ids are recorded in **`meta.deleted`** as tombstones. This is what stops a reconnect merge against an older copy of the file from resurrecting something you deleted while the folder was disconnected. `mergeStates()` unions by id, prefers the higher `updatedAt` on a conflict, then subtracts the union of both sides' tombstones.

### Schema migrations

| From | Shape | How it migrates |
|---|---|---|
| v1 | `funds` / `fundId`, flat | Each entity becomes a category holding one same-named fund |
| v2 | `categories` / `categoryId`, flat | Same — icon and colour go to the category, money settings to the fund |
| v3 | two-level | Loaded as-is |

The migrated fund **keeps the old id**, so every existing ledger row still resolves without rewriting. Verified against the live data file: 8 categories, 10 entries, balances and cash reserves identical before and after.

### Durability layers

| Layer | What it does |
|---|---|
| `data/funds.json` | Live file, rewritten on every change |
| `data/backups/funds_<date>.json` | Dated snapshot, written once per day |
| Google Drive | Version history on both of the above |
| `localStorage` mirror | Crash net; union-merged back into the file on reconnect |
| Export / Import JSON | Manual snapshot from the ••• menu; the fallback in browsers without the FS API (Safari) |

### The "Reconnect your data folder" banner

Expected, not a fault. Chrome does not persist File System Access permission across browser sessions for a non-installed site — the directory handle survives in IndexedDB but its permission reverts to `prompt`, and re-granting requires a user gesture. The banner appears once per browser session; one click clears it.

While disconnected the app still works and still saves to the localStorage mirror. On reconnect, `mergeStates()` unions the file and the mirror **by entry id** rather than letting the file win, so anything logged during that window is recovered and immediately written back. The ledger is append-only with unique ids, which is what makes the union conflict-free; category metadata takes the mirror's version. Covered by the merge suite.

To avoid the prompt entirely, either install the page as a Chrome app (⋮ → Cast, save and share → Install page as app), which unlocks persistent file permissions, or move saving to the local server that `start.command` already runs.

## Status

**Phase**: schema v10. A parse check plus 27 suites, 2,121 assertions, all passing. Visually reviewed in a browser for the first time on 2026-09-08 — see "Partially verified" below for exactly what that covered.

**Cash position** (top of the rail, always visible)
- **Cash reserves** — what's in the bank, set by hand
- **Allocated** — sum of every category balance
- **Credit card** — what's owed on the card, set by hand the same way; shown only when non-zero
- **Unallocated** — cash minus allocated minus card owed: what's left if every category were spent to $0 and the card were paid off. Green when positive, red when funds and the card together promise more than the bank holds.

**Category rail** (persistent left sidebar, present on every view)
- One row per category: identity chip (colour + icon), name, balance, `+` / `−` quick-add buttons
- The selected category is marked with its own colour: a left bar, a tinted background and border
- Envelope meter and a status pill that appears **only when the category wants attention** — over budget, overdrawn, past due, behind a schedule

### Cash reserves are a series, not a number

Money moves every month — an extra $1,000 here, a transfer there. A single mutable figure would silently rewrite what "unallocated" was on **every past date**, so `cashReadings` holds `{ id, date, amount, note }` and `cashAt(date)` returns the newest reading up to that point. Adding today's figure never touches an earlier one.

One reading per date: re-entering the same day corrects that day rather than stacking a duplicate. Back-dating slots into place and only affects dates from then on. The dialog shows the whole trail with the delta between consecutive readings.

Pre-v5 files carried `meta.cashReserves` as a scalar; `normalize()` seeds it as a single "Opening balance" reading dated `cashUpdatedAt`. Verified against the live file — same amount, same unallocated, nothing else touched.

### Credit card float

A card purchase shrinks the fund it came from immediately — that's correct, it's real budget used, the same regardless of payment method. What it doesn't do is leave the bank: that happens later, whenever the statement gets paid, up to a billing cycle away. Without tracking that gap, `Unallocated` quietly overstated what was truly free by however much was currently sitting unpaid on the card.

`cardReadings` is the exact same shape and mechanism as `cashReadings` — `{ id, date, amount, note }`, `cardAt(date)`/`cardNow()` mirroring `cashAt`/`cashNow`, updated the same lightweight way (check the card's real balance, type one number) rather than one entry per purchase. `setCardReading`/`deleteCardReading` are literal twins of `setCashReading`/`deleteCashReading`, right down to one-reading-per-date collapsing a same-day correction instead of stacking.

```
unallocated = cashNow() − allocated() − cardNow()
```

Every place that showed cash/allocated/unallocated now shows the card figure alongside when it's non-zero: the rail's cash box, the cash dialog (folded into the same "Update reserves" flow rather than a separate one, so both numbers get checked in one sitting), and the "What's it for?" allocation dialog — which had been computing `cash − alloc` directly instead of calling `unallocated()`, so it needed the same fix or it would have silently disagreed with the rail.

**The cash forecast only gets the correction at its starting point.** `cashForecast()` walks the bank balance forward a year, splitting it into allocated/unallocated as it goes; the initial split subtracts `cardNow()` to match today's number everywhere else, but the walk has no modeled event for "the card gets paid" — so the correction ages out over the following months the same way an unpencilled one-off would. Modeling the payoff itself (which month, how much) would be a real feature, not a fix, and wasn't asked for.

No migration needed: old files simply get `cardReadings: []`, `cardNow()` returns 0, and `unallocated()` computes exactly as it did before this existed.

### Budgets and income are dated too

Same principle, applied to the last two mutable values. `fund.budgets` is `[{ from: "YYYY-MM", amount }]` and `meta.incomes` the same shape; `budgetOfFund(f, mk)` and `incomeAt(mk)` return whatever was true in that month.

This is what stops raising Groceries from $1,500 to $1,600 in September retroactively excusing an overspend in March. Every roll-up takes an optional month — `budgetOfCat`, `totalBudgeted`, `monthlySpending`, `monthlySaving`, `leftover` — so any historical question is asked of the values that applied at the time.

Editing a budget writes an entry effective **this month**; re-editing the same month corrects it rather than stacking, and a change that restates the existing amount collapses to nothing. Pre-v6 scalars migrate to a single entry dated from the fund's `createdAt`.

### Moving money

Money moves between funds, or back out to unallocated, without being income or spending. `moveMoney(from, to, amount, date, note)` writes both legs tagged `kind: "transfer"` with a shared `pairId`:

- **fund → fund** — total allocated is unchanged, unallocated is unchanged
- **fund → null** — *release*: the fund shrinks, unallocated grows, the bank is untouched. This is how a ballooning Travel fund gets thinned.
- **null → fund** — allocate spare cash into a fund

Transfers are excluded from `credited`/`spent` and from the credits and expenses tables — counting them would inflate every month a move happened in. `monthStats` reports them separately as `movedIn`/`movedOut`, and the fund page grows a **Moved** table. Undo removes both legs together via the `pairId`, because deleting one side would conjure money.

### Activity feed

One place to answer *"what did I do recently"* and *"where did that $40 go"* without knowing which fund it lives in — the gap left when per-fund tables replaced the old global history. Searches note, fund name, category name, formatted amount and formatted date, so `water`, `$40.00`, `jul` and `preschool` all work. Paginated at 25 with **Show more**; clicking a row jumps to its fund.

### Keyboard

<kbd>a</kbd> quick expense · <kbd>c</kbd> credit · <kbd>e</kbd> expense · <kbd>s</kbd> split an expense across funds · <kbd>m</kbd> move · <kbd>f</kbd> fund the month · <kbd>/</kbd> search · <kbd>Esc</kbd> back to overview · <kbd>?</kbd> the list. Suppressed inside inputs and while any dialog is open. On a fund page, `c` and `e` pre-select that fund. On a month page, `a`, `c`, `e` and `s` all log against that month (`routeMonth()`); everywhere else they log against the current month.

### Editing a fund shows its consequences

Correcting a bill from $490 to $315 changes three things at once: the monthly contribution, the next payment, and whether the fund is now over-funded. The fund dialog previews all of it live before you save — old → new for each figure, plus what happens to the money already in there.

Worked example (Preschool, $490 × 9 months):

| | before | after |
|---|---|---|
| Each bill | $490 | **$315** |
| Monthly contribution | $367.50 | **$236.25** |
| Committed | $490 | **$315** |
| Free | $0 | **$175** |

The balance is never touched. The over-funding simply stops being committed and surfaces as free, which `⇄ Move` can release. Because budgets are dated, the new figure applies from the current month and earlier months keep what they had.

**One thing deliberately not dated:** `schedule` itself. Budgets, income, cash readings and the ledger are all dated records; the schedule is a forward-looking *model* of a recurring bill, and its curve is a target rather than a record. Changing it does shift the dashed reference line on past months. Worth revisiting if bill-amount history ever matters.

### Earmarks

A one-off claim on money a fund **already holds**. Travel has $7,000 and a $6,000 trip is coming in May 2027: that's neither a credit (no money arrives) nor an expense (none leaves) — just the extra fact that most of Travel is spoken for.

`state.plans` holds `{ id, fundId, name, amount, month, note, settledAt }`. An outstanding earmark adds to `committedOfFund` alongside any recurring schedule, so the rail line, the stacked bars and the category split all account for it with no extra wiring. **Spend** records the real cost as an expense and settles the earmark in one step; **Remove** drops the plan and moves no money. Deleted plan ids join the same `meta.deleted` tombstone list as ledger rows, so a merge can't revive them.

### Monthly plan

`meta.monthlyIncome` against `totalBudgeted()` — the sum of every fund's monthly contribution. A scheduled fund contributes its **level** figure ($472.50/mo), never its bill ($5,670), which is the whole point of the sinking-fund maths.

**Two kinds of monthly cost, which the single figure was hiding:**

| | | |
|---|---|---|
| **Spending** | Leaves the account this month | groceries, power, subscriptions |
| **Holding** | Stays in the bank, held for a bill that lands later | property taxes, insurance, registrations |

Both cost the same each month; only one is money actually gone. The split is per **fund**, not per category — Utilities holds Water (spending) beside Trash (saving for a quarterly bill), so no category-level rule could express it. The card leads with `income − spending − holding = left over`, shows a type bar above the per-category one, and the table breaks every category into both columns.

Rendered as stacked **allocation bars**, not a pie. A pie was the obvious reach and the wrong one: nine slices, long names, values within a few dollars of each other — and, decisively, a pie cannot show more than a whole. When the plan costs more than comes in, the bar runs **past a marked income line** and the overspend is visible. Segment labels are measured and omitted rather than clipped when a slice is too thin; the table below carries every figure with its share.

### What a balance is actually spoken for

A category total hides how much is already claimed. `commitmentParts()` splits a fund's balance three ways, each claim taking what it can from the remainder in order of how hard it is:

| Claim | What it is | Priority |
|---|---|---|
| **Bills** | A dated recurring payment — the schedule's next amount | 1 |
| **Earmarks** | A named one-off, e.g. a trip in May 2027 | 2 |
| **Budget** | What's LEFT of this month's allowance after what you've already spent | 3 |
| **Free** | Whatever survives all three | — |

Parts always sum to the balance and none can be negative, so nothing overflows the bar. A scheduled fund contributes no separate budget claim — its monthly contribution is already inside the bill figure.

**Including this month's budget was a correction.** Counting only dated bills reported $10,393 committed of $22,060, which read as though $11,667 were spare. It isn't: "we spend $1,500 a month on food" is a real claim. The honest figure is **$16,060 committed, $6,000 free** — and that $6,000 is almost entirely Travel's buffer above its monthly rate, which is exactly the money the trip earmark should claim.

Spending during the month shrinks the budget claim, so it decays toward zero as the month is consumed. A rolled-over buffer *above* one month's budget stays genuinely free.

Shown as three stacked segments (dark grey / light grey / green) in *Balance by category* and *Balance by fund*, as four lines in the cash box, and in both table twins.

### Cash forecast — `#/forecast`

Its own page, reached from **Forecast** in the header. Everything else in the app answers *"is this fund on track?"*; this answers *"what does the bank account do over the next year?"* — a different question with a different unit (dollars in the bank, not dollars per envelope), so it gets its own route rather than another card on the overview.

The subtlety is **which money actually leaves**. A contribution into a sinking fund doesn't: it's still your money, just relabelled, and subtracting it would double-count against the bill it's saving for. What leaves is day-to-day spending plus the scheduled bills **in the months they land**. So each row is:

```
closing = opening + income − day-to-day spending − bills due this month + one-offs
```

The horizon is selectable — **1 / 3 / 5 years** — and persisted, because it is a preference about how you think rather than a fact about the data. Beyond twelve months the page says plainly that it assumes today's plan holds unchanged: same income, same budgets, the same bills every year. It is what happens if nothing changes, not a claim that nothing will.

Sixty columns needed two fixes in `drawStackedColumns`: a floor on bar width so they don't become hairlines, and label thinning that **measures** rather than guesses — a label every `step` bands only works if the labels fit in `step` bands. The forced final label is dropped when it would collide with the one before it, which a 360px × 60-month test caught.

`cashForecast(horizon = 12)` walks from `horizonStart()` with `cashNow()`, returning a row per month plus `lowest` / `lowestMonth`. Level funds contribute their budget to `spending`; scheduled funds contribute nothing to `spending` and their `amountFor(month)` to `bills`.

**A one-off outside the forecast window used to vanish silently.** With a September plan start the forecast runs Sep→Aug, and the dialog defaulted its month to *this* month — August — so accepting the default produced an entry that showed in the list, changed nothing, and gave no hint why. A $6,400 paycheck went missing that way.

Three changes, because one wasn't enough: the default is now `horizonStart()` (the first month the forecast can see) and the picker's `min` matches; any one-off outside the window is dimmed and marked *not counted*; and a banner totals what's being ignored and offers to move them in, undoably. The rule is that the app must never hold a number it is quietly not using.

One-offs are **editable**, not just removable — a pencilled-in figure is a guess, and guesses get revised. The dialog doubles as the editor (`openOneOff(id)`), the row keeps its id so the forecast follows the change rather than treating it as a new item, and the list re-sorts if the month moves. Removing one is an undoable toast that lifts the tombstone as well as restoring the row — putting the object back without that would see it deleted again on the next load.

**One-offs** are the pencilling-in mechanism: `$3,000 tax refund in April`, `−$9,000 wedding in June`. Direction is a choice in the dialog, stored as the sign. They shift every subsequent closing balance and nothing else — they never touch a fund, a budget or the ledger.

The page shows a hero (cash 12 months out), a KPI row (lowest point / income / typical outgoings / one-offs pencilled in), a **stacked column chart**, the month-by-month table, and the one-offs list.

The chart splits each month's projected cash into **allocated** and **unallocated**, which answers a question the single line couldn't: how much of a growing pile is actually spoken for. The split is tracked alongside the walk rather than derived afterwards, so the two parts always sum to `closing`:

```
allocated   += monthlyHolding(m) − bills(m)      // level funds net to zero: budgeted in, spent out
unallocated += income(m) − totalBudgeted(m) + one-offs(m)
```

Both fills clear the validator on both surfaces (deutan ΔE 27.6 light / 27.9 dark). Tritan separation is weaker in dark mode at 5.1, which stacking covers: the series order never changes, so position identifies a segment before colour does — asserted in the geometry suite. If any closing balance goes negative a red banner names the month — the one thing the page exists to catch.

Verified against the live file: the 12 rows bill **$18,149**, exactly the sum of every fund's annual schedule, so nothing is double-counted or skipped. Lowest point $68,692 in January; net +$2,765 over the year.

### Buffer funds — when the month genuinely can't be judged

Healthcare at $250/mo might cost $0 in June and $1,000 in July, and neither is a mistake. The other three fund kinds all claim to know what a month costs — a budget, a bill, a seasonal figure — so all three can be judged monthly. This one can't, and judging it anyway produced **Over budget** on a fund behaving exactly as designed.

`buffer: true` (the editor's **Unpredictable** type) changes what question gets asked. Not *"did you spend more than $250 this month?"* — the fund has no answer to that — but *"is the balance surviving?"*:

| | |
|---|---|
| Balance below zero | **Overdrawn** (critical) |
| Below the `floor`, if one is set | **Below $1,000 reserve** (warning, offers the top-up) |
| Anything else | **Buffer** — quiet, whatever the month did |

**The floor is the only knob**, and it's optional. Without one, a buffer is incapable of raising anything except going negative. That's deliberate: a fund you've explicitly told the app is unpredictable shouldn't get a second, sneakier way to nag you.

**Catch up** tops the balance back to the floor in one entry. `catchUpAmount()` reads the *same* balance `fundStatus` does — money dated ahead included — so the button and the badge that prompts it can never disagree about the number, and a contribution already recorded for next month isn't funded twice. It lands in the **Unpredictable** card on the fund page, mirroring where the scheduled kind puts its own catch-up, and the needs-attention list routes through the same helper rather than writing its own entry. What it writes is an ordinary credit dated today, noted `Catch-up to $1,000 reserve` — editable and deletable like any other, and it never touches the monthly contribution. Clicking it twice is a no-op.

**Months of cover** replaces "of budget left" everywhere the number would have been meaningless. `recentDraw()` averages the trailing six **complete** months — quiet months included, because averaging only the months that happened to have a bill inflates the burn rate and understates how long the money lasts. The current month is excluded, or a fund read on the 2nd would look like its spending had collapsed. With no history it falls back to the monthly contribution.

Three knock-on decisions, each of which could have gone the other way:

- **Commitment split** — the floor is committed, the rest is free. A buffer with no floor is entirely free. It's the most raidable money you have, which is the point of holding it as cash rather than against a dated bill.
- **Monthly plan** — a buffer counts as **spending**, not holding. The money does leave, just unevenly; it isn't being saved toward a known bill.
- **Cash forecast** — the contribution is subtracted as day-to-day spending, unchanged. Over twelve months the lumpiness averages out, so the level figure is the right expectation.

A schedule and a buffer are mutually exclusive: the schedule already says what the draws are, which is exactly what a buffer says it can't know. `normalize()` drops the flag (and the floor with it) if both are set.

### Ceilings — the mirror of the floor

Any fund can carry a `ceiling`. Above it, the fund reports `$340 above its ceiling` and offers a one-click **Release** that moves the surplus back to unallocated.

**Two decisions define it, and both could have gone the other way.**

**It never sweeps on its own.** Everything that writes to the ledger in this app happens because someone clicked. An automatic sweep has to fire somewhere — on load, on render, on every expense — and a mutation in a read path is how you get duplicate transfers and balances moving mid-edit. It also can't tell surplus from a deliberate stock-up. So a ceiling only ever *flags*; `releaseFund()` is never called without a confirm.

**It can never release committed money.** `releasableOf()` is `min(balance − ceiling, balance − locked)`, where `locked` is the greater of `commitmentParts().committed` and any savings `target`. Without that guard a ceiling would strand a scheduled fund and immediately create the shortfall another button exists to fix — one part of the app manufacturing work for another.

Probed against the live file by putting a hypothetical $2,000 ceiling on all 31 funds:

| Fund | Balance | Over | Releasable | |
|---|---|---|---|---|
| Travel | $7,000 | $5,000 | **$5,000** | genuinely spare |
| Property Taxes | $5,670 | $3,670 | **$0** | guard held back $3,670 — it's a dated bill |

The release is an ordinary `moveMoney(fund → null)` transfer: excluded from credited/spent, visible in the **Moved** table, undoable via its `pairId`. The bank balance doesn't change — only the label on the money does, so allocated falls and unallocated rises by the same amount.

`overceiling` is ranked **last** in `RANKS` and only ever reported when the fund is otherwise healthy — `fundStatus()` wraps `baseStatus()` and returns early on any non-good tone. Having too much money must never mask being overdrawn.

### Fund the month doesn't double-credit what's already funded

Reported live, on the app's actual first day of real use: 24 of 30 funds were already funded for September, the dialog said so right at the top — and every one of those 24 was still pre-filled with its full monthly figure. Clicking through as-is would have credited a second month's worth to funds that didn't need it; the only defence was noticing and zeroing each one by hand.

The warning banner was reading the right thing (`kind: "allotment"` dated this month) but the row amounts never looked at it — `budgetOfFund(f)` unconditionally, funded or not. Two facts had drifted apart that should never have been able to.

**`monthSuggestion(f, mk)`** decides each row now, and the answer depends on what kind of fund it's asking about — because "funded" doesn't mean the same thing for all four:

| Fund kind | Not yet funded | Funded, but still short | Funded and caught up |
|---|---|---|---|
| Varying (has a schedule) | the level contribution | `cycleOutlook(f).gap` — the same figure **Catch up** already uses | $0 |
| Sinking (buffer) | its monthly figure | `catchUpAmount(f)` — the same figure the buffer's own **Catch-up** button uses | $0 |
| Budget / Fixed | its monthly figure | — (see below) | $0 |

A level fund has no curve to fall behind on — there's nothing for it to be "short" against beyond this month's own figure, so for those two kinds "short" only ever means "not funded yet." A Varying or Sinking fund can still be short even *with* this month's allotment recorded, if earlier months were never funded — reusing `cycleOutlook`/`catchUpAmount` rather than inventing a second gap calculation means the number Fund the month suggests can never disagree with the number the fund's own Catch-up button offers.

**Deliberately not fixed**: a fund can hold real September money without `monthSuggestion` seeing it — a Quick Expense credit, or anything entered outside Fund the month, carries no `allotment` tag by design (see "Funded" means an entry tagged `kind: "allotment"`, above). Four of the live file's 30 funds are in exactly this state: money already in them for September, entered by hand, still offered their full monthly figure here. That's the same tagged-vs-any-credit distinction the rest of the app already draws, not a gap this fix introduces — the balance line next to each row (`balance $1,345`) is what surfaces it, same as it always did.

Verified against the live file: 24 of 30 read `$0 · already funded`, none of the 24 flagged short (Property Taxes included, even after releasing $1,417.50 of it to unallocated the same week — its December bill still doesn't need it back), and the suggested total dropped from what would have been the full monthly plan to $2,790 — exactly the six funds genuinely still open for September.

### "What's it for?" — naming every obligation

`$18,872 in bills & earmarks` is a number you can't act on. The **What's it for?** button in the cash box opens a dialog (`#allocDlg`, closed with ✕ or Esc) that names every single obligation and says when it lands.

**Not a pie chart.** With 24 obligations a pie breaks the ≤6-slice rule outright, and worse, it can't show *timing* — which is the actual question. The form is a **list grouped by when the money is wanted** (Overdue / This month / Later this year / Next year and beyond / Open-ended), each row carrying a magnitude bar, with one stacked bar at the top for the overall shape.

**The invariant is that the rows reconcile.** `obligations()` builds from `commitmentParts` rather than from funds directly, so the sum always equals the `committed` figure in the rail — verified against the live file at $18,872 on both sides. Consequences of building it that way:

- A scheduled fund contributes what its **cycle** needs, not its balance. Property Taxes holding $5,670 against a $5,500 curve requirement reports $5,500, and the extra $170 stays free.
- Earmarks are filled **in date order** from whatever the fund can actually cover. A fund holding $7,000 against a $6,000 and a $4,000 earmark shows the first in full and the second at $1,000, flagged `only part of $4,000 is covered`. Nothing is invented.
- An overdrawn fund commits nothing.

**Budget rows collapse in the view.** Fifteen rows reading `August budget` buried the bills the list exists to show, so the view folds them into one (`August budget · 17 funds`) while `obligations()` keeps the full data. A test asserts the collapse loses nothing.

Colour is by *kind* — bills, earmarks, reserves, budget, free — reusing tokens already validated elsewhere rather than introducing a new ramp, and every row carries its kind in text, so identity is never colour-alone.

**Two things the first version got wrong, both about the bar:**

- **Its scope was ambiguous.** A green `Unallocated $49,175` sat directly above a bar whose green segment was `Free $6,150` — two greens, adjacent, meaning different things, so the bar read as though it showed the $49,175. The bar now lives in its own bordered block headed *"Inside the $25,022 allocated to funds"*, captioned with what it excludes, and the unallocated line is rendered in **plain ink rather than green** (red is kept for the negative case). Green in this dialog now means one thing only.
- **The bar disappeared entirely**, because `alloc-box` was already the id of the monthly-plan bar on the overview. `$("#alloc-box")` returns the first match in the document, `#view` precedes `#allocBody`, so the dialog drew its bar into the overview's chart — losing it from the dialog *and* corrupting the overview's. Renamed to `allocSplitBox`; the static suite now fails on any duplicate id outside a justified allowlist.
- **The legend was hardcoded while the bar was filtered.** Segments are dropped at `value > 0.005`, so with no earmarks anywhere you got a blue *Earmarks* swatch and no blue bar. The legend is now generated from the same `segs` array the bar is drawn from, and carries each segment's amount. A test asserts the two can never diverge.

### Reserve is its own bucket — contingency money is not free money

Auto Maintenance holding $1,150 against a $1,000 floor used to read *"$1,000 in bills & earmarks, $150 free"*. Both halves were wrong: it isn't a bill, and the $150 isn't spare in any sense that matters. The whole balance sits there for when something breaks.

The distinction the model was missing is **protective vs discretionary**, and it already had the flag for it — `buffer`. Travel's balance is genuinely yours to choose about; Auto Maintenance's isn't. So `commitmentParts` gained a fifth bucket:

```
{ bills, reserve, earmarks, budget, free }
```

A buffer's balance goes to `reserve`, not to `bills`, and **all** of it does. The floor is not what makes it reserved — the fund kind is.

**Floor and ceiling answer different questions**, which is what makes this coherent:

| | |
|---|---|
| `floor` | *"warn me below this"* — drives the `lowreserve` status |
| `ceiling` | *"above this really is spare"* — the only thing that creates free money in a buffer |

So a buffer with no ceiling has `free: 0` by construction. Set a ceiling and the reserve stops there, releasing the rest. That also means `releasableOf` needed the floor in its locked set: a ceiling *below* the floor is a contradictory config, and releasing out of a fund already under its warning line is the one outcome neither setting could have wanted. `lockedOf()` is a single function precisely because `releasableOf` decides the amount and `confirmRelease` describes it, and the two must never disagree.

Sinking funds appear as their own band on both bar charts, their own line in the rail's cash box, and their own column in the table twins.

### The balance line had three faults at once

Reported on Auto Maintenance: a line doubling back, `Aug 26` printed twice, and a filled band floating between $1,000 and $1,150 with nothing below it. Three separate bugs, one visible symptom.

1. **`balanceSeries` appended a "today" point without checking today was later.** It exists to carry the line to the present, but a fund with a *future-dated* entry — September's contribution, entered in August — got a final point back in the past. The series ran `Aug 26 → Sep 1 → Aug 26`: the line doubled back, the area self-intersected, and the x-axis printed the same date at both ends. **Every one of the 31 live funds was affected**, because they all carry a September "Fund the month" credit — as were the category charts and the all-fund total. Now only appended when `last < today`.
2. **The area's baseline wasn't zero.** `niceTicks(min, max)` over 1000–1150 put the axis nowhere near zero, so a filled area — which encodes magnitude — showed a 15% change as the entire chart, and `Y(0)` fell far off-canvas. Now `niceTicks(min(0, …), max(0, …))`. Negatives still reach below the line.
3. **Duplicate x labels.** Two ticks a few days apart can render the same short string; adjacent duplicates are now dropped.

The "red line" was not a bug — Cars is a red category, and the fund chart is themed in its hue.

This also needed the chart harness's fake DOM taught to return a stub for marks queried inside the emitted SVG, so `drawBalanceLine`'s hover wiring can attach. It had no geometry coverage before precisely because it threw on `$(".hit", svg)`.

### Quick expense — the thing that decides whether the app survives

Twenty-nine funds in a `<select>` is what stops a budget being kept. Every expense costs a dialog, a scroll and two clicks, and after a week you stop bothering. Typing is the only interaction fast enough for daily use:

```
a   →   45 groceries lunch with sam
        −$45  ● Groceries + Toiletries  · lunch with sam      → $1,345
```

`parseQuickAdd()` takes an amount, a fuzzy fund name and a note. **Expenses are the default** because they are what actually happens, which is what the button is named for; a leading `+` still makes it a credit. Fund matching tries exact, prefix, substring and initials (`hoa` → HOA Dues, `cp` → Car Payment), and takes the **longest phrase that matches**, so `120 car insurance renewal` finds Car Insurance and leaves "renewal" as the note rather than matching "car" and swallowing the rest. A genuine tie is reported, never guessed — `10 car` names both candidates instead of picking one.

The preview under the input shows exactly what will be recorded, including the resulting balance, so Enter is never a surprise.

### Split expense — one purchase, several funds

A $200 Target run that's $140 groceries and $60 kids' stuff used to have to become two unlinked entries, logged separately, with nothing tying them back to the one receipt they came from. The split dialog is built around the total rather than around a fund: type the total first, then divide it across as many funds as the receipt actually touched.

It doesn't get its own button in This month's hero row — a fifth action there was one too many, and splitting is rare enough not to earn permanent real estate next to Budget/Expense/Quick expense. Instead, **Add expense** grows a `⊞ Split` button in its own top-right corner, styled the same red-outline `.btn-expense` as the Expense button so it reads as a sibling action rather than a buried footnote — shown only in expense mode (a budget credit has nothing to divide). Clicking it hands off whatever's already typed (amount, date, note) straight into the split dialog rather than throwing it away, so pivoting mid-entry costs nothing. The `s` shortcut still opens it directly.

Each row is a search-or-pick field (an `<input>` bound to a `<datalist>` of every fund name — native browser autocomplete gives both click-a-dropdown and type-to-filter for free, no combobox library needed) plus an amount. A running line under the rows reads `Allocated $140.00 of $200.00 — $60.00 left`, and Save stays disabled until every row resolves to a real fund with a positive amount **and** the parts sum to the total exactly — the one thing a split absolutely cannot get away with silently getting wrong.

**Each part is just an ordinary expense.** `addSplitExpense()` writes one ledger entry per fund, `kind` left `null` like any other expense, so balances, `monthStats`, the fund's own Expenses table and Activity search all already count it correctly with zero special-casing anywhere else in the app. The only thing tying the parts together is a shared `splitId` — the same pattern `pairId` already uses for a transfer's two legs — which exists for exactly two things: the confirmation toast's Undo removes every part in one shot (`deleteSplitGroup`), and a small **split** tag appears next to the note in both the Expenses table and the Activity feed, with a tooltip naming the total and every fund involved. Past that one-shot undo, each part is an ordinary entry — editable and deletable individually afterward, exactly like any other row, because a split is a purchase you're pretty sure of, not a transaction that needs protecting from your own future edits.

Deliberately not run through the duplicate guard: a split is inherently several same-day, same-note entries, and per-leg duplicate-checking would flag exactly the pattern it's supposed to produce.

### Smaller things that earn their place

- **The month-funded nudge.** The monthly funding is a manual click and forgetting it is the one failure that breaks everything quietly: balances drift, statuses go wrong, and nothing says why. `monthFunding()` counts funds that *should* have been funded against those that were, so a half-finished month is caught too, and it leads the needs-attention list rather than sitting among the per-fund problems.
- **Duplicate guard.** Same fund, same amount, same day asks once before recording. Logging a coffee twice is the commonest way a ledger goes silently wrong. Editing an entry never flags itself.
- **Spend pace.** For level funds only — a scheduled fund is *supposed* to spend in lumps. Compares the fraction of the month elapsed against the fraction of budget used, speaks only once the month is 15% through, and stays silent before `planStart`: an empty August is a month that hasn't happened yet, not restraint. The words carry the direction too — underspending reads *"running under"*, not *"behind pace"*, because behind on a spending budget is the good direction.
- **Annual cost of the plan** on the overview: $84,444/yr, $7,037/mo across 29 funds.
- **CSV export** alongside the JSON snapshot. A JSON snapshot restores this app; a CSV answers questions it can't. Properly quoted — commas, embedded quotes and newlines all round-trip.
- **Backup pruning.** Every backup from the last 30 days, plus the first of each month forever. Unbounded daily files in a Drive-synced folder is a slow leak, and Drive is already versioning the file.

### This month — `#/month/<YYYY-MM>`

One page per month, reached from **This month** in the header or `t`. The same screen answers two questions depending on which month you pick: mid-month it is *how am I doing*, for a finished month it is *what happened*. Two pages would have duplicated every figure to change one verb.

Arrows step month to month (never past next month). Mid-month it shows a progress bar for the month itself. Per fund: **planned / budgeted / spent / remaining**, where *planned* is the budget for a level fund and the bill itself for a scheduled one — a scheduled fund's remaining reads `—` because outspending its monthly budget in a due month is the design, not a miss. (Called *Difference* until it was pointed out that "$500 planned, $98 spent, difference $402" doesn't read as an answer to any question you'd actually ask — *remaining* does.)

A finished month with anything over plan grows a **Worth a look** section, and each row offers `Budget $520` — one click to make the budget match what actually happened. Budgets are dated, so that changes *this month onward* and leaves the history alone.

### Bill calendar

On the forecast page: one row per fund that actually bills, twelve columns, shaded by how heavy the month is.

`billCells()` decides what a fund bills in a month, and the answer differs by kind. **Fixed lands every month** — a calendar without it understates every single column, which was the first version's mistake. **Varying** reads its schedule. The other two don't bill at all: a Budget is a limit you spend against, not an obligation, and a Sinking fund is money waiting for an expense nobody has scheduled.

Three summary rows, because the two kinds answer different questions:

```
           Sep     Oct     Nov     Dec     Jan     Feb  ...
Fixed     $929    $929    $929    $929    $929    $929      never moves
Varying $6,810    $805    $790    $920  $6,869  $1,090      the lumpy part
ALL     $7,739  $1,734  $1,719  $1,849  $7,798  $2,019
```

Live file: $11,150/yr Fixed, $22,309/yr Varying, $33,459 together. Heaviest January at $7,798, lightest June at $1,474 — a $6,324 swing on top of an immovable $929 floor. The subtotals partition the total exactly (asserted per column), and the grand total equals every scheduled annual plus every fixed budget × 12.

### Fixed bills

A fifth fund type, `fixed: true` — the same amount every month, like Netflix or a phone plan. It exists for one reason: logging it should stop being a decision. The amount, the fund and the note are all already known, so the fund gets a **✓** in the rail and **Mark paid** on its page instead of an entry dialog.

`payFixed()` adds only the *remainder*, so a partly paid month tops up rather than doubling, and clicking twice is a no-op. What it writes is an ordinary, deletable expense — nothing special the rest of the app has to know about. Mutually exclusive with `schedule` (which already knows its months) and `buffer` (whose point is not knowing); `normalize()` drops the flag rather than ignoring it.

**An optional `dueDay` (1–31) turns "is this paid" into "is this late".** Not every Fixed bill has one — some don't land on a predictable day — so it defaults to unset and unset never flags anything, whatever the balance. `fixedPaid(f, mk)` returns `{ due, spent, paid, dueDay, dueToday, overdue }`: `overdue` only fires for the *current* month, only once the day has actually passed, and never once `paid` is true. Reaching the due day itself is `dueToday`, not `overdue` — the day arriving isn't lateness yet, so it earns a quiet badge rather than a needs-attention row.

`baseStatus()` gives an overdue Fixed bill its own key, `billoverdue`, ranked alongside `short` — urgent, but a click away from fixed, not catastrophic like overdrawn. It carries `pay` (the amount still owed) rather than `fix`: `issues()` and the needs-attention list route it to an expense (**Mark paid**), not a credit, because crediting an already-funded bill would double it. The rail badge and the fund-page hero badge read **Overdue** or **Due today**; the fund page also shows **Due the 15th** as a quiet caption when neither applies. Marking paid clears the badge and drops the fund off the needs-attention list exactly like any other fix.

### Undo instead of confirm

A `confirm()` before a delete asks the question at the worst possible moment — you haven't seen the result yet, so you click through it. `toast(message, undo)` does the thing and offers the way back for seven seconds, when you can see what changed. Deleting an entry, undoing a move, quick-adding and marking a bill paid all go through it. Destructive-and-hard-to-reverse actions (deleting a fund or category, which cascades) keep their confirm.

### The four fund types

| Name | Means | Judged on |
|---|---|---|
| **Budget** | spend up to a limit — groceries, fuel | spent vs the limit, this month |
| **Fixed** | a known bill, same every month — Netflix, the phone | has it gone out yet (one-click ✓) |
| **Varying** | a known bill that differs by month — insurance, quarterly water, summer electricity | its accumulation curve over the year |
| **Sinking** | set aside for something you know is coming but not when — tires, a boiler | balance surviving; never judged monthly |

Live file: 8 Budget, 8 Fixed, 10 Varying, 4 Sinking.

The names sit on two axes, which is what makes them learnable: **Fixed and Varying are both known bills**, differing only on whether the amount changes month to month. **Sinking** is the one where neither the amount nor the date is known. **Budget** is the odd one out — not a bill at all, a limit.

*Sporadic* was the first attempt at Varying and was wrong: it describes irregular **timing**, but House Energy is billed every single month — what varies is the amount. And an earlier note here claimed the app's *Sinking* was backwards versus textbook usage. That was overstated: the narrow "known obligation" sense is corporate bond finance, while in household budgeting a sinking fund routinely means setting aside monthly for something whose timing you don't know. The app's vocabulary is the ordinary one.

**Varying is one type, not two.** The editor used to offer *"only certain months"* and *"different each month"* separately, but the model never did — `scheduleInfo()` has always canonicalised both into a **12-slot amounts array**, and a quarterly bill is just four equal months and eight zeros. Same shape, same maths, same type. A test asserts the two authoring paths produce byte-identical `amounts`, `monthly`, `annual`, `curve`, status and caption, so *how a schedule was typed* can never change what it means.

What that leaves is one editor: **the twelve boxes are the model**, with a quick-fill row above them — an amount, month toggles, and a Fill button that writes that amount into the chosen months **and zeros the rest**. Zeroing matters: "quarterly $100" means nothing in the other eight months, and leaving old figures behind would silently keep a bill you just said isn't there. `describeSchedule()` still distinguishes the two shapes when it reads back (`$100 × 4 months a year` vs `12 payments from $110 to $440`), because *uniform* is derived from the amounts rather than from how they were entered.

### The cash box explains itself

Two of its four lines had to be explained in conversation — *"does reserves just mean sinking funds?"* and *"what does bills & earmarks include for this month?"* — so every row now carries a `data-tip`.

The recurring misreading is worth naming: **these are balances HELD, not amounts due.** `bills & earmarks` is money already saved toward Varying bills, which on the live file is $11,920 against $6,810 actually due next month — bigger, because it includes what is accumulating toward January's four-bill cluster. The tip says so and quotes `dueThisMonth()` alongside, so the two numbers are visible together rather than one being mistaken for the other.

Also worth knowing when the figures don't tie out: **Fixed bills are not in `bills & earmarks`.** A Fixed fund is judged month by month, so its unspent amount sits in `this month's budget`. The cash box therefore splits differently from the bill calendar, which counts Fixed and Varying together as things you owe.

### All funds — the rebaseline table (`#/allfunds`, `b`)

Thirty funds means thirty visits to the fund editor to answer one question: *does the plan still fit the income?* This is one table, every fund, one editable figure each, with a live total against income and an explicit **Save**.

Nothing touches `state` until you press it. Edits live in `draftMonthly` (fundId → number); the row and the summary repaint **in place** rather than through `render()`, because a full re-render would steal focus mid-keystroke. Changed rows tint, show a signed delta, and the button counts them (`Save 6 changes`). Leaving with unsaved edits asks first, and the whole save is one undoable toast.

**A Varying fund has no single monthly figure**, so it doesn't get an input pretending otherwise — a fund with twelve different bills was showing a derived average in a box you could type into. Its row shows the average as a **button** that expands twelve inputs inline, plus the two bulk moves that make rebaselining quick:

```
House Energy   Varying   [ $212 ▾ ]                    $2,550/yr
  Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
 [110][110][120][135][175][190][275][440][400][165][140][110]
  Every month [    ] · or scale by [ 90 ]%  [Apply]   $191/mo · $2,295 a year
```

**Scale** multiplies all twelve, so the seasonal shape survives — electricity still peaks in July, only its level moves. **Every month** flattens them. Either way the average, the delta and the running total update live.

**The Type column is a dropdown too**, so rebaselining can change *what a fund is*, not just what it costs. The monthly figure carries across so the running total never jumps: becoming Varying seeds twelve equal months from it (a starting point to edit, not a guess at seasonality) and opens the panel; leaving Varying keeps the level contribution as the new flat figure. Dropping Sinking clears its minimum — `normalize()` would do that on load anyway, but the save has to do it too or the in-memory fund and the reloaded one disagree.

The draft therefore has three parts: `draftMonthly[id]` for the funds with one figure, `draftAmounts[id]` for the twelve, `draftKind[id]` for the type. When both figure-shapes exist for one fund the twelve win, so a fund can never have two answers.

The contribution is read back from the saved schedule rather than assumed, which matters at the edge: scaling to zero leaves twelve zeros, `normalize()` rightly treats that as no schedule at all, and reading `info.monthly` off the null crashed the save until a test found it.

Saving goes through `setBudget(f, v, thisMonth())`, so it changes **this month onward** and leaves history intact — the same dated-budget rule as everywhere else.

### How a green suite hid a blank page

Moving the sections between pages took `viewOverview`'s closing `}` along with the block being cut, and pasted it into `viewMonth`. The result: `viewMonth` closed early, its chart code dangled at top level, and the app rendered nothing. Three separate things let that through, and all three are now fixed:

1. **A balanced file is not a correct one.** Deleting a block that includes a function's final `}` leaves the braces balanced — every later function is simply swallowed into the previous body. `tests21` now asserts every top-level function closes at column 0 before the next begins, with a one-liner exemption and a control that eats a brace to prove the check fires.
2. **`parsecheck` failed and I read it as passing.** A crash printed only `script error`, so grepping the run for `FAIL` matched nothing. Every bad outcome now contains the word **FAILED**, an empty result counts as a failure rather than silence, and the run ends with `all green` or `SUITE FAILED`.
3. **No test covers a whole page's data path.** `adhoc.py` now carries the plan helpers, so a one-off smoke script can walk every page's figures against the live file. Worth running after any structural move.

The deeper lesson is that this suite tests *logic*, not *rendering* — a file can pass 1,958 assertions and still show a black screen, because nothing here ever calls `render()`.

### Where the actions live

Sections are timeframes; actions used to be pulled out of them entirely on the theory that logging an expense isn't a thing you do *in the present tense* — it's the verb you do constantly, from wherever you happen to be. That put **⚡ Quick expense in the header**, beside the tabs, on every page.

In practice the header button was the loudest thing on the page — a solid blue "primary" button sitting between the sync pill and the section tabs, competing with navigation for attention rather than sitting among the other actions. It also meant Quick expense, unlike Budget and Expense, could only ever log against *today*: no way to backfill a forgotten expense into last month, or pencil one into next month, without hand-editing the date field.

**All three actions now live together on This month**, in the hero row, in the order you actually reach for them: **+ Budget**, **− Expense**, **⚡ Quick expense**. Quick expense wears the same styling as the Expense button (`.btn-expense`) rather than the old header's loud solid blue — it's still an unlabelled amount+fund+note field underneath, but visually it now reads as one of the three, not as the one that outranks the other two. And critically, **all three work for every month you can navigate to**, not just the current one — This month's ← / → arrows step to any month, and the buttons ride along unchanged. `openEntry(f, sign, mk)` and `openQuickAdd(mk)` both take the month being viewed and default the entry's date inside it: today's actual date on the current month, the 1st of the month otherwise — so logging into July while viewing it in August needs no manual date correction. The dialog titles and subtext say which month they're writing to whenever it isn't the current one, so an edit made while browsing an old month is never mistaken for one landing today.

The **a / c / e** keyboard shortcuts inherited the same awareness via `routeMonth()` — fired from a month page they log against that month; fired from anywhere else (a fund page, the overview) they fall back to the current month, which keeps the original "log what just happened, from wherever you are" reflex working for the shortcut even though the button no longer sits in the header.

**Fund the month** stayed on This month, unchanged — a *Fund September · $4,820* button when the month is unfunded.

The Overview still has no action buttons. It answers *where do I stand* and nothing else — a read-only page, with one link through to this month.

### One timeframe per page

The Overview had drifted into holding three at once — the plan (setup), this month's figures, and the long-run balance line — so "how am I doing?" and "what did I decide?" answered in the same scroll. Each page now answers one question, in one tense:

| | Question | Tense |
|---|---|---|
| **Rail** | What is the budget made of? | the structure itself |
| **Plan** (`b`) | What is every month meant to look like? | intended |
| **Overview** | Where do I stand right now? | present |
| **This month** (`t`) | What actually happened? | past, one month |
| **Forecast** | What is coming? | future |

What moved, and why:

- **The Monthly plan section → Plan.** Income − spending − holding = left over, the spending/holding bar, and *where it goes* by category. It's the setup, and Plan is where you change the setup, so the summary and the editor now sit on one page. It was also duplicating the income/budgeted/left-over line the editor already had.
- **"This plan costs $84,444/yr" → Plan**, replaced on the Overview by *Remaining Budget*. A yearly cost is a fact about the plan, not about today.
- **"Net change this month" → This month**, beside *Where the money went*. Two views of the same month, previously a page apart.

The Overview keeps only the present: what you hold, what needs attention, where it sits, and what changed lately.

**Still missing: a Trends page** — month-over-month spending, net by month, category drift. Deliberately not built: with one month of real data it would be an empty chart. The balance-over-time line stays on the Overview until there is enough history to deserve its own page.

### Places versus tasks — when the rail shows

The rail is a **navigation** aid: it lists every fund with its balance so you can move around while reading. That earns 296px on a page you *browse* — overview, category, fund, month — where you click between funds constantly.

It earns nothing on a page you came to **do one thing** and then leave. `FOCUSED = { allfunds, forecast }` drops it: both are tasks, both carry the widest tables in the app (a 14-column bill calendar, a 12-input month grid), and on neither would you navigate to a fund. The rail isn't just hidden by CSS — `renderRail()` is skipped, so thirty rows of DOM aren't built to be thrown away.

The test for whether a future page belongs in that set: *would you click a fund in the rail while doing this?* If yes it's a place, if no it's a task.

### Saying a thing once

Three cleanups from a real session, all the same underlying fault — the same information stated twice:

- **The Budgeted and Expenses headings each carried a coloured dot** restating what the chart legend directly above already said (green = budgeted, red = expenses). Beside the balance chart's own category-hued legend that made two greens sit near one word. The dots are gone; the legend is the key.
- **Move had a button on both the fund and category pages** and was pulled for being unused — every real case seemed covered by *Release* (over a ceiling) or by editing the fund. That assumption didn't survive contact with a real one: a scheduled bill (Property Taxes) deferred to a later month than its usual due date left a genuine surplus with no ceiling to trigger *Release*, and no visible way to hand it back to unallocated without it reading as spending.

  **First attempt** put a bare `⇄ Move` button back on the fund page, opening the same dialog `m` always did. Too little: it asked the same three questions (From, To, Amount) whether or not there was anything to release, and starting the amount blank meant doing the arithmetic yourself before you could even confirm.

  **What it became: `Deallocate $X`**, shown only when there's something to deallocate, with the exact safe figure pre-filled — confirming needs no arithmetic, but the dialog is still the full Move dialog underneath, so the amount or the destination fund can still be changed. The figure comes from a new `deallocatableOf(f)`, the same guard as `releasableOf` — never committed money, a savings `target`, or a buffer's `floor` — just without the ceiling cap, since `commitmentParts(f).free` alone doesn't know about `target` and would over-offer for a fund saving toward a goal but not yet over any ceiling. **Release and Deallocate never show together**: Release only appears over a ceiling and is capped by it (fast, one-click, no dialog); Deallocate only appears when Release has nothing to offer. One button, whichever applies, never two competing numbers for the same money.
- **Earmark was buried** in a card halfway down the fund page while Budget and Expense sat at the top. It is the same class of action, so it now sits with them.

Also fixed: `.entries` is `table-layout: fixed` with `.c-act` sized for **two** buttons, so the earmark rows' third (Spend / Edit / Remove) hung outside the cell. They opt into `.acts3`, which widens that column at both breakpoints.

### One word per concept

The rail said **reserves** while the fund type was called **Sinking** — two words for the same money, which is exactly the confusion that prompted "what's in that $4,350?". The bucket now takes the type's name everywhere: cash box line, chart legend, table column and the obligations list all say **Sinking**.

That freed *reserve* to mean one thing, so the floor became the **minimum**: `Below its $1,000 minimum`, `Minimum to keep` in the editor, `Top-up to the $1,000 minimum` on the entry it writes. Previously "reserve" meant both the pot and the floor of the pot.

**Cash reserves** is untouched — it means money in the bank, which is a genuinely different thing from either.

### Tooltips

`data-tip` on any element, one delegated listener for the lot. Delegated rather than bound per element because the rail is rebuilt on every render — direct bindings would need rebinding thirty times a render and would leak the first time that was forgotten.

Native `title=` waits about a second and renders as an OS tooltip, which is too slow to answer *"what does this button do"* while the pointer is already moving. This shows in 90ms, sits above the control (flipping below near the top of the window), clamps to the viewport, and clears on click, scroll and blur so one can't be left hanging over a dialog.

**Rendered with `textContent`, not `innerHTML`.** The browser decodes an attribute before `getAttribute` returns it, so `innerHTML` would re-parse whatever a fund name happened to contain — a fund called `<img onerror=…>` would have executed. Bold emphasis wasn't worth that, so tips are plain text with `white-space: pre-line` and `&#10;` for a second line.

The two escaping rules differ by construction site and are easy to get backwards: tips written **into HTML source** interpolate through `escapeHtml`, tips set via **`setAttribute`** must not — escaping there renders `Kids &amp; Co` literally.

### Hover tables — the cash box's breakdown rows, one level deeper

The plain tooltip above answers *what is this number*; it can't answer *which funds make it up*, because it's deliberately `textContent`-only — no fund name can ever be re-parsed as markup, but that also means no table. `data-hovertable="dueNow|earmarks|reserve|free"` is a second, parallel hover system built specifically to answer the second question, on the four rows under **In funds** that break the total down (This month's budget, Earmarks, Sinking funds, Free).

Same instant-hover feel as the tip (90ms delay, clamps to viewport, flips below near the top, clears on click/scroll/blur/mouseout) — deliberately a **second module**, not a mode bolted onto the first, so the plain tip's XSS-safety property stays simple and total rather than conditional on which attribute set it.

`breakdownRows(bucket)` reads `commitmentParts(f)[bucket]` per fund, keeps only the funds actually contributing (`> 0.5`), and sorts by amount descending — so "Sinking funds" hovered shows every Sinking fund and exactly how much of the total is theirs, verified against the live file to reconcile to the penny with the row's own number. A category-hued `swatch-dot` per row ties it back to the same colour the rail and charts already use. More than a handful of rows scrolls internally (`.ht-scroll`, capped at 220px) rather than growing the popover past the viewport.

Only shows when there's something to show: `show()` returns early on an empty `breakdownRows()`, so hovering "This month's budget" or "Earmarks" when the row itself reads $0 does nothing — same restraint as the row-hiding rule for Free and Sinking funds above it.

### Layout rules that keep buttons on one line

Three separate causes, all producing "why is this on two rows":

- **Buttons wrapped their own labels.** `Fund the month` breaking into two lines made one button look like two. `white-space: nowrap` on every button, globally.
- **The overview action row had `flex-wrap: wrap` hard-coded**, so four buttons beside a 52px hero figure wrapped by default rather than only when they had to. Now `.hero-actions`, which wraps below 1000px and never above it.
- **The rail row was a fixed 4-column grid** — `name | balance | + | −`. Adding the fixed-bill ✓ made five children and the fifth fell to a second row. The actions are now one grid cell holding a flex row, so a sixth button could be added without the same thing happening again.

**The fund Type control is a `<select>`, not a segmented control.** Five options was already cramped and the labels are the useful part — a dropdown gives each one room to say what it is (*"Fixed bill — the same amount every month"*) plus a hint line underneath explaining when to pick it. A segmented control earns its place at two or three options, not five.

### Cache busting and the build stamp

The whole app is one file, so a cached copy means a browser silently running last week's build. This cost a real debugging session: the `a` shortcut existed in the file and not in the page, and the tell was that `?` listed every shortcut except the new one. There are now `no-store` meta tags, and **Data & backup** shows `Build <date> · schema vN` so "what are you actually running?" is answerable.

### The rail meter means two different things — so it says which

A level fund's bar fills as you **spend** (full = bad). A scheduled fund's fills as you **save** (full = good). Identical bars, opposite direction. Rather than hide that, every caption leads with the verb:

| Fund kind | Caption | Bar fills toward |
|---|---|---|
| Monthly budget | `Spent $0 of $200` | its limit |
| Buffer, healthy | `Holding $1,150 ($2,304/yr)` | full, or its floor |
| Buffer, below its floor | `Holding $400 · $600 below its $1,000 reserve` | its floor |
| Irregular expense, safe | `Holding $967 ($1,450/yr)` | full |
| Irregular expense, behind | `Holding $578 · $131 short by Apr` | what it would need |
| Irregular expense, short now | `$33 short of $100 due Sep` | its next bill |
| Savings goal | `Holding $0 of $2,400 goal` | its target |

A saving bar also carries a small end-cap marking the target. A **Due now** badge appears beside the caption only in a month a payment actually lands — the one case that needs acting on — and reads `Due now · short` when it won't cover.

One rule now covers every kind: **quote the warning when there is one, the annual cost when there isn't.** Level funds always carry it (`Spent $5 of $17 ($204/yr)`), and scheduled and buffer funds carry it whenever they're healthy. Months of cover moved off the rail caption to the fund page's Unpredictable card, where there's room for it — the rail has to stay one short line.

A safe fund quotes its **annual cost** rather than saying "covers the year". Both mean the same thing — a safe fund is by definition covered — but only one of them tells you something you didn't know, and it matches the shape of the level funds' caption. The two warning states keep their warnings: what's wrong matters more than what it costs.

**The caption must never contradict the colour.** An earlier version always quoted the ideal savings curve — `Holding $578 of $709 needed now` — while the *colour* came from the forecast. A fund can sit below the curve and still be perfectly safe, because a larger-than-usual contribution is already recorded; Preschool did exactly that, reading like a warning beside a green bar. The caption now quotes the curve only when the fund is genuinely behind it, and the bar fills `bal / (bal + gap)` so it is **full whenever the year clears**. A regression test asserts a safe fund never reads like a short one.
- Running total at the top; the active category is marked with `aria-current`
- **Scrolls independently** — `max-height: calc(100vh - 40px)` with its own overflow, so a long fund list doesn't drag the page and the rail can be held wherever you like.
- **Accordion** — one category open at a time. Thirty funds fully expanded is ~68 rows; one open is ~16. A plain click on a twisty swaps which is open, clicking the open one closes everything, and **shift-click** keeps more than one open for comparison. Navigating to a category or fund focuses it and closes the rest. The category you're viewing is **not** pinned open beyond that — an earlier "never hide what you're on" rule fought the accordion, so opening a second category left the first one showing too.
- State is the set of **open** ids in `localStorage` (`sinking-expanded-v1`), not the data file — toggling never writes `funds.json` or triggers a backup. An explicitly empty set is honoured; only absent or corrupt storage falls back to the default (the active category, else the first).
- Reorder mode respects the accordion rather than flinging everything open: every category header is always visible, and the open category's funds are reorderable, so nothing is unreachable.

**Overview** — read-only, per "Where the actions live" and "One timeframe per page" above; the action buttons and monthly figures documented below now live on **This month**, not here.
- Hero total across all categories + KPI row (budgeted / spent / remaining budget / unallocated, this month)
- **Fund the month** — one dialog budgets every category at once, amounts suggested per fund (see below — not just each one's flat monthly budget), editable, 0 to skip. Warns if the month is already funded. The note defaults to just the month ("September 2026") and is yours to overwrite.
- Total balance over time (area + hover crosshair), range filter
- **Balance by category** — sorted by balance, clickable through to the detail view.

**Category detail** (click any category, or `#/category/<id>`)
- Hero balance + KPIs (budgeted, spent, remaining budget, avg monthly spend & runway)
- Balance over time for that category
- Budget and expenses by month — budgeted above the zero rule, expenses below
- Separate full-width **Budgeted** and **Expenses** tables: fixed column widths, colour-coded signed amounts, per-row **Edit** and **Delete**, and a "Show deleted entries" toggle exposing **Restore** and **Erase**
- The page is themed in the category's colour — hero gradient and top rule, a dot on each section heading, and the balance chart drawn in that hue

Table twins carry the same **colour and icon** the charts do — `idCell()` emits the category's hue dot and icon, so a popped-out table still reads as the chart it came from — plus signed colouring on credited/spent/net and an em-dash for zero rather than `$0`. The one exception is the category page's per-fund table, where every row is a fund in the *same* category: a constant chip is clutter, not information.

Every chart has a table-view twin, shown in a **dialog** rather than inline. Inline it pushed the rest of the page down and never lined up with the chart it belonged to; a popup gets the full dialog width and leaves the page still. `chartCard()` records each chart's title so the popup names itself, only one is open at a time, and the flag clears on `close` however it was dismissed — otherwise the button looks dead on the second click. Light/dark both selected, not flipped.

## Verification notes

**Run them with `./tests/run.sh`** — it regenerates every harness from the current `index.html` and runs the lot, exiting non-zero on any failure.

Suites run on Node (`run.sh` is bash — Git Bash on Windows, the system shell on macOS/Linux). Harnesses are *generated*, not stored: `rebuild.py` slices the real functions out of `index.html` into `tests/.gen/*.js`, so a test can never drift from the code it checks. This matters — stale hand-built harnesses silently masked failures across five suites until the generator was introduced. `adhoc.py <script.js> [--live]` builds a throwaway harness (`tests/.gen/run_adhoc.js`) for one-off investigation, with `--live` substituting the real `data/funds.json`; run it with `node .gen/run_adhoc.js`. All paths in `rebuild.py`/`adhoc.py` are derived from the scripts' own location, so the project can move without editing them.

Originally run on JavaScriptCore via `osascript -l JavaScript` (macOS-only). Ported to Node once work moved to Windows — same harnesses, same assertions, `.gen/` replacing `/tmp` as the scratch location. The move surfaced one real bug in the harness itself: the "spend pace" test in `tests28.js` compared against the live wall-clock date with a margin that clamped away near either edge of the month, so it failed on specific real-world dates depending on when the suite happened to run. Fixed by pinning that test's "today" to a fixed mid-month date.

**"Today" is pinned across every suite, not just that one test.** The first time `./run.sh` actually ran in September, seven suites failed at once — ~60 assertions, zero real regressions. Fixtures across the project assumed "today" sits in a specific month relative to their data ("the bill is due September, today is August"; readings dated the 25th or 26th treated as already in the past) without ever computing that relative to real `thisMonth()`. None of it surfaced until the calendar actually crossed into September, which is exactly the failure mode a suite exists to catch *before* it happens somewhere that matters. `rebuild.py` now appends an override to `sec1` itself — the one place every harness (including the two custom ones, chart geometry and accordion) gets `todayStr` from — so its no-argument case ("what is today") always returns a fixed `2026-08-31` regardless of the real date, while an explicit argument (`todayStr` is also used to format some *other* date) still works normally. `2026-08-31` specifically: late enough in August that readings dated the 25th–26th read as already past, early enough that nothing due in September has happened yet — the actual constraint several fixtures needed at once. One change, one place, permanent — instead of patching each fixture's assumption individually, which would only have deferred the next month-boundary failure to whichever suite hadn't been touched yet.

| Suite | Count | Covers |
|---|---|---|
| v4 model | 84 | v1→v3 and v2→v3 migration, roll-ups (fund → category → total), scoped stats and series, worst-of status, reordering within a group, permanent delete + tombstones, in-place edit incl. moving an entry between funds, merge honouring deletes and newer edits, archive cascade |
| Chart geometry | 472 | Real draw functions against a fake DOM, parsing the emitted SVG: label collisions at 4 widths × 6 data shapes, viewBox overflow, bar direction vs sign, zero-anchoring, shared row order, tick thinning |
| Next-payment projection | 71 | The real reported Trash bug reproduced and fixed, pre-funded months never double-counted, a paid due month rolling the target forward, partial payments still counting as due, annual/monthly/quarterly shapes, no projection without a schedule, banked-vs-projected wording never overclaiming, spend-vs-save captions, and the due-this-month badge |
| Needs attention | 36 | What qualifies, ordering by severity, the fix amount matching the fund's own gap, per-month dismissal not carrying over, keys reflecting the problem, a clean set producing nothing, archived funds excluded, and a Fixed bill's due day: no day set never flags, overdue-and-unpaid carries a `pay` amount, due-today is a badge not yet a needs-attention row, already-paid is never overdue, and marking paid removes it from the list |
| Static references | 11 | Every function called in `index.html` is defined — catches a wired handler whose function was deleted by an edit; **no function is declared twice**, the mirror-image failure where a block replacement pastes a duplicate and the later copy silently wins; **every element wired at load actually exists**, since one missing id throws during load and silently takes every listener registered after it; and **no element id is used twice** outside a justified allowlist, which is how the allocation dialog's bar ended up drawn into the overview's chart. Each check ships with a negative control that reintroduces the original bug and asserts the check fires |
| Obligations & reserves | 69 | The reconciliation invariant across every fund kind, each kind named and dated, once-a-year bills vs a run of them, a scheduled fund reporting its cycle need rather than its balance, earmarks filled in date order with the uncovered part flagged, sorting by when, archived funds and settled earmarks dropping out, an overdrawn fund committing nothing, empty worlds, the view's budget collapse preserving the total, and **contingency vs discretionary**: identical balances in a buffer and a plain fund splitting opposite ways, the reserve rolling up separately from bills, and committed + free always reconstructing the balance |
| Ceilings | 76 | Releasing the surplus and landing on the ceiling, no-ops with no ceiling / under it / exactly on it / overdrawn, the guard refusing to touch a fully committed scheduled fund, whichever cap binds first, savings targets and earmarks protected, floor and ceiling together and a contradictory floor-above-ceiling, real problems outranking it, reaching needs-attention as a release rather than a fix, the transfer being reversible and neither income nor spending, unallocated rising while the bank stays put, round-trip and coercion — plus `deallocatableOf`: the everyday no-ceiling case, a savings target protected even though `commitmentParts` alone doesn't know about it, a buffer with no ceiling reserving everything regardless of its floor, nothing free means nothing offered, and Release/Deallocate never claiming the same money |
| Plan start | 21 | August's bill dropping out, the exact $440 difference, no forecast points before the plan, a future plan's first month still contributing, seeding the smaller amount, bills before the start never chased, normal behaviour once underway, hardening |
| Seasonal schedules | 69 | Per-month amounts, curve self-consistency, a full simulated year returning to its seed, a big summer bill not reading as overspending, legacy fixed-amount files still working, padding/coercion/clamping, and the one-line description adapting to shape |
| Varying expenses | 60 | Curve maths for the preschool case, self-consistency of every step, a full simulated year returning to its seed without dipping negative, status following the curve rather than the month, slightly-behind vs behind, quarterly/annual/monthly shapes, schedule hardening and round-trip, and for level funds: no nagging when uncredited, over-budget measured against budget not credit, overdrawn still winning |
| Earmarks | 41 | The named-trip case, coexisting with a schedule, over-earmarking capped at the balance, ordering with undated last, settling into a real expense, removal moving no money, editing, hardening, older files without plans, merge with tombstones |
| Dated budgets & income | 46 | Point-in-time lookup, September's rise not excusing March, same-month correction, no-op collapse, back-dating, roll-ups per month, income series, per-month leftover, v6 migration, hardening |
| Bill correction | (in Monthly plan, 65) | The real $490→$315 case end to end: annual and monthly recalculated, earlier months keeping the old budget, balance untouched, surplus becoming free, status staying Ready, releasing the surplus not counting as spending |
| Moving money | 44 | Thinning to unallocated, releases counting as neither income nor spending, fund-to-fund leaving totals intact, allocating from spare cash, undo taking both legs, guards on self/zero/negative, overdrawing, commitment split undisturbed, round-trip |
| Activity search | 18 | Ordering, search by note/fund/category/amount/date, case and partial matching, no-match, cross-category, note-less entries, transfers included |
| Cash readings | 69 | Point-in-time lookup, adding a reading leaving history intact, same-date correction, back-dating, unallocated tracking the series, v4 migration from the scalar, hardening, deletion with tombstones, merge from both sides — plus the credit card balance twin: same mechanics end to end, unallocated subtracting card debt on top of cash and allocated, old files defaulting to no card debt |
| Monthly plan | 46 | Income arithmetic, overspending, exact balance, no income set, scheduled funds contributing their level cost, archived funds excluded, round-trip and coercion, shares summing to 100%, and the spending/holding split (per-fund not per-category, one category holding both, level contribution never the bill, all-one-type, archiving leaving both buckets) |
| Commitment split | 53 | Monthly budget counting, spending shrinking the claim, a rolled-over buffer staying free, bills taking priority, hardest-first settlement when money is short, parts always reconstructing the balance with no negatives, negative balances, roll-ups reconciling, archived funds excluded |
| Accordion rail | 31 | One-at-a-time swapping even while viewing another category, closing the last open one, shift-click multi-open, navigation focus, reorder mode respecting it, localStorage round-trip, corrupt vs explicitly-empty storage, stale ids, empty rail, and that toggling leaves `state` byte-identical |
| Delete & archive | 42 | Fund delete takes its entries, category delete cascades to funds and entries, tombstones survive a reload, impact counts, archive/restore round-trips at both levels, archived-item discovery, delete on an archived item |
| Primitives | 119 | Month arithmetic across year boundaries, tick generation, money formatting, cash-reserve arithmetic and coercion, 16-hue assignment and wrap-around, icon-set integrity and search |
| Buffer funds & catch-up | 92 | A big month never reading as over budget and the same fund without the flag still doing so, a zero month, overdrawn still winning, the reserve floor and its exact top-up, reaching needs-attention only when low, trailing-average cover incl. quiet months and excluding the current one, the fallback with no history, the bar meaning "safe", the commitment split, counting as spending not holding, mutual exclusivity with a schedule, round-trip and coercion. **Catch-up**: adding exactly the gap, idempotence, dated-ahead money not funded twice, button/badge/attention-list agreeing on one figure, no-ops on floorless, level and scheduled funds, an overdrawn fund brought all the way back to the floor rather than to zero, the entry being a normal deletable credit whose note never says "schedule", contribution untouched |
| Invariant fuzz | 8 | 400 randomly generated states — every fund kind, random schedules, buffers, ceilings, earmarks, one-offs, archived funds, negative balances — asserting that the commitment split always reconstructs the balance, no bucket is negative or NaN, obligations always reconcile, a release never exceeds free nor breaches a floor, every fund has a renderable status and meter, and the forecast always splits cleanly. Seeded, so a failure is reproducible |
| Fixed bills & month view | 80 | Marking paid and the no-op second click, a partly paid month topping up not doubling, the entry being ordinary and deletable, mutual exclusivity with schedules and buffers, the flag dropped rather than ignored, last month judged separately from this one, the over-budget list and its dated re-budget, and the calendar covering the year exactly once — plus `monthSuggestion` for all four fund kinds: not-yet-funded suggests the normal figure, funded-but-short suggests the same gap Catch-up would, funded-and-caught-up suggests nothing, and a level fund is never "short" beyond simply not being funded yet — plus `dueDay`: optional and coerced/clamped to 1–31, junk and negatives fall back to unset, and it survives a reload round-trip |
| Rebaseline table | 86 | The draft moving without touching state, an edit set back to its old value counting as no change, saving every changed row at once, budgets staying dated, a Varying fund scaling all twelve slots and keeping its peak month, scaling to zero dropping the schedule instead of crashing, undo restoring the schedule and not just the number, and funds with no schedule or all-zero bills never being rescaled |
| Quick expense & extras | 82 | Amount forms (`$`, commas, decimals, signs), fund matching by exact/prefix/substring/initials, longest-match beating a short one, ambiguity reported rather than guessed, archived funds unmatched, errors never throwing; the funding nudge incl. half-funded months and ordinary credits not counting; duplicate detection incl. self-exclusion when editing; pace only for level funds; annual cost; CSV quoting |
| Cash forecast | 74 | Contributions staying in the bank while bills leave it, a bill month vs a quiet month, each opening chaining from the previous closing, one-offs landing in their month and lifting every later balance, negative one-offs, a negative low point being surfaced with its month, add/delete with tombstones surviving a reload, coercion and normalize stability |
| Split expense | 30 | Each part an ordinary linked expense (balance, monthStats, expenses list all pick it up with no special casing), `splitTip` naming the total and every fund, `deleteSplitGroup` undoing the whole thing in one shot with tombstones, deleting one part individually leaving the others alone, `splitId` surviving a `normalize()` round-trip and a `mergeStates()` merge, and `matchFundLoose`'s exact/prefix/substring/initials/no-match/archived-excluded cases |
| Live data | — | The actual `data/funds.json` migrated v2→v3 with balances, categories and reserves identical; and the forecast's 12 rows billing exactly the annual schedule total |

**Colours**: series blue clears 3:1 on both surfaces. Credit green / expense red measure CVD ΔE 7.8 light / 7.1 dark against an 8.0 target — the "legal only with secondary encoding" band, satisfied four times over (separate tables, explicit signs, labelled dots, above/below the zero rule). Identity hues 9–16 are for choice, not reliability.

**Partially verified, 2026-09-08**: a real Chrome pass (against `127.0.0.1:8756`, live `data/funds.json`) clicked through Overview, This month, Plan, Forecast, a category page and a fund page, the Add expense and Quick expense dialogs, and the Split expense dialog both from its own flow and hand-off from Add expense. No console errors on any of it. Still unverified: everything not listed above — most dialogs (Fund the month, Move, earmarks, category/fund edit, cash and card readings, one-offs), the reorder-mode rail, and the router's less common paths. Every suite still tests logic or emitted SVG, never a real DOM, so this pass is the only line of defense against a wiring mistake outside what was actually clicked.

A forecast what-if feature (two sliders: income %, a flat monthly amount) was built, tested and verified working in this same pass, then reverted at the user's request — it answered "what if income changed economy-wide," not the actual question ("what if I moved money between categories"). See Known gaps below for what's actually wanted.

## Known gaps

**Resolved in v3:** category ordering, sortable/filterable entry tables, permanent delete (entries, funds and categories), archive/restore, two-level structure, 355 searchable icons, 16 colours.

**Resolved since:** splitting one expense across funds (below), and the all-category history gap this list used to carry — the Activity feed (above) already covers it and had simply outlived this list's last edit. This is the first full re-read of this list against the actual code rather than against memory of when each line was written; everything below survived that check.

**Still open**
- **No entry templates** ("weekly shop $250" in one click). Tabled.
- **Import replaces everything.** `mergeStates()` exists and is tested but isn't offered on import.
- **No recurring auto-fund**; the monthly credit is still a manual click, though the app now nudges when a month is unfunded.
- **The Plan page (`#/allfunds`) doesn't preview forecast impact.** The birds-eye-view half of "what if" is already solved — Plan edits every fund's figure at once without touching saved state (`draftMonthly`/`draftAmounts`) — but changing a draft figure there doesn't show what it would do to the cash forecast (lowest point, 12 months out) before **Save** commits it. A first attempt at "what if" instead shipped as two forecast-wide sliders (income %, a flat monthly amount) and was reverted — it answered "what if income changed economy-wide," not "what if I moved money between categories," which is what was actually wanted.
- **The forecast assumes today's budgets hold all year.** Income is read per month from the dated series, but a budget change next March isn't something you can pencil in — only a one-off is. Raising a budget today rewrites the whole forecast, which is the same gap the point above is about.
- **The schedule itself isn't dated.** Editing a bill from $490 to $315 changes the model everywhere, including in retrospect. Deliberate — the schedule is a forward model, not a record — but it means the forecast can't show what you *used* to expect.
- **Cash reserves can go stale silently** — a hand-set figure with no nudge.
- **Ceilings are not dated**, unlike budgets and income. Changing one rewrites the judgement retrospectively.
- **A split expense isn't wired into the duplicate guard or CSV export.** Deliberate for the duplicate guard — a split is inherently several same-day entries, and per-leg checking would misfire on legitimate same-amount lines. Not deliberate for CSV, just untouched: an exported split part reads as an ordinary `entry`, with no way to tell from the export alone that it was one purchase.

**Performance** — the table below was measured on JavaScriptCore, back when the suite ran via `osascript`; it undersells actual speed, since the app runs in Chrome's V8 and the harness now does too (via Node), narrowing that gap. Not re-benchmarked after the move.

The commitment split made every render ask for the same balances and month totals dozens of times (`commitmentParts → projection → monthStats`, per fund, from the rail *and* both charts *and* both tables). That took a 2,000-entry render from 13 ms to **105 ms**. `balanceOfFund` and `monthStats` are now memoised, cleared on every mutation and every load:

| Ledger | Before | After |
|---|---|---|
| 500 | 9.6 ms | **4.3 ms** |
| 2,000 | 105 ms | **44 ms** |
| 5,000 | 248 ms | **105 ms** |
| 10,000 | 632 ms | **187 ms** |

Ledger scans per render: 193 → 57. Next lever, if ever needed, is indexing entries by fund and by month at load rather than filtering.

## Conventions

- `snake_case` filenames; dated notes as `YYYY_MM_DD_description.md`
- No GSD project ID — do not create GSD sections/tasks for this project

## Directory Structure

```
02_sinking_app/
├── CLAUDE.md       # This file
├── index.html      # The whole app — no build step, no dependencies
├── start.command   # Double-click launcher (static server on :8756) — macOS only, see below
├── start.bat       # Same, for Windows — manual/fallback; see serve_hidden.vbs for autostart
├── serve_hidden.vbs # Windows: same server, silent, no browser — run at login via Startup folder
├── stop.bat        # Windows: stop whatever's listening on :8756
├── tests/
│   ├── run.sh              # regenerate every harness and run them all (needs Node)
│   ├── rebuild.py          # slices real functions out of index.html
│   ├── adhoc.py            # one-off harness, --live uses the real data file
│   ├── validate_palette.py # the dataviz colour validator, ported
│   ├── tests*.js           # the suites themselves
│   └── .gen/               # generated harnesses — scratch, rebuilt on every run
├── docs/           # Notes, design decisions
└── data/           # Created on first save
    ├── funds.json
    └── backups/
```
