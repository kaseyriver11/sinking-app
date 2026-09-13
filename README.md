# Sinking Funds

A personal envelope-budgeting app for tracking sinking funds and long-term
balances — categories and funds, monthly budgets, an expense ledger, and a
cash forecast. Deliberately simple: no bank syncing, no transaction import,
one file, no build step.

**Live app:** https://kaseyriver11.github.io/sinking-app/

## Using it on another device (including your phone)

Open the live link above and sign in with Google. Your data syncs through a
private Supabase project scoped to your account — nothing is shared or
publicly readable — so any signed-in device sees the same categories, funds,
and ledger. There's nothing to install; a browser tab is all you need.

Signing in is optional. Skip it and the app still works entirely offline in
that browser, saving to a local file or to that browser's own storage — see
**Local / offline mode** below. The two aren't linked automatically; if
you've been using local mode and want it synced to your account too, that's
a one-time import from the "•••" menu, not something the app does silently.

## Local / offline mode

No sign-in required. Just open `index.html` directly in Chrome
(`file://` works fine) — on first run, click the pill in the header →
**Choose data folder…** and pick this project folder. Everything then reads
from and writes to `data/funds.json` in that folder.

- **macOS:** `start.command` serves the folder at `127.0.0.1:8756` instead
  of using `file://` — only needed if you want to install the page as an app
  for persistent file permissions across restarts.
- **Windows:** the same local server can auto-start at login via
  `serve_hidden.vbs` (see `CLAUDE.md` for setup); `start.bat` / `stop.bat`
  cover a manual start/stop.

Local mode and cloud mode are independent — signing in never touches or
requires a local folder, and using a local folder never requires signing in.

## Running the tests

```
./tests/run.sh
```

Regenerates test harnesses straight from `index.html` (so a suite can't
silently drift from the code it's checking) and runs the full set — logic
and rendering assertions, no browser required beyond Node.

## Project layout

```
index.html        # the whole app — no build step, no dependencies
auth.js           # optional Google sign-in + Supabase cloud sync
db/               # Supabase schema + dated migration files
tests/            # the test suite (see above)
data/             # created on first local save — gitignored, never committed
```

## More detail

`CLAUDE.md` in this repo is the project's own working notes — the reasoning
behind most design decisions, the full data model, and a lot of "why it
works this way" that doesn't belong in a README. Worth a read if you're
digging into the code.
