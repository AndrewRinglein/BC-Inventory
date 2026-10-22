# BC Inventory

Box tracking for BC's flash (pull-tab) tickets, from purchase order to sold out, with the
compliance report built from the floor scans. Copied from the bingo
[Inventory-Management](https://github.com/AndrewRinglein/Inventory-Management) app at commit
`e7dabdc` and reworked for BC; it shares no database, deployment or code path with it.

See `SETUP.md` for going live and `docs/SPEC.md` for where the product spec lives.

## What it does

- **Purchase** — order builder over the game catalog; one PO per distributor, review then send
  (or record a PO placed by phone). A game with no cost yet goes out as "?".
- **Receive** — set the day received, invoice number and (optionally) the PO, then scan. Each
  scan (`<form number> <serial>`) puts the box in stock immediately; with a PO it claims one of
  the boxes that PO put on order. An unknown form number opens **Add game**. **Done** works out
  what is still missing and builds the shortage / amount-to-pay emails.
- **Open** — pick the session date and scan a box to open it (date + exact time recorded). Every
  open box ends as **Sold out**, a **Remainder** (tickets left; it stays open into the next
  session, every count kept) or **Close unsold** (retired with tickets left).
- **Reports** — the compliance report: every box closed (or opened) in a day, range or month,
  with serial, open and close times, receipt invoice, and the ticket-sheet attributes as they
  were when the box was received. Summary cards, sort on any column, print, CSV.
- **Inventory, Open Orders, Accounting, History, Dashboard, Games, Settings** — carried over from
  the bingo app, simplified to one location and box-only games.

## Architecture

- React (Vite) single-page app — `src/`
- Supabase: Postgres (`supabase/migrations/001_bc_schema.sql` + `002_bc_seed.sql`), auth, storage,
  edge functions (`send-email`, `read-invoice`, `weekly-export`)
- **Demo mode**: with no `.env`, the app runs in the browser (localStorage) with the 38-game
  catalog. Password: `boxes`. Add `&demo` to any link for the training sandbox (fake data at every
  stage, "Reset demo data" button).
- One store interface, two implementations: `src/lib/store/demoStore.js`,
  `src/lib/store/supabaseStore.js`. Screens never know which is active.
- Box lifecycle `on_order → in_inventory → opened → sold_out | closed_unsold` (+ `missing`),
  enforced in `src/lib/logic/boxes.js` and by the `guard_box_state` trigger, which also stamps the
  open / sold-out / closed times server-side.
- Remainder counts live in `box_counts` (never edited); the latest is on `boxes.tickets_remaining`.
- Every change to boxes, counts, POs, games and payments is audited to `events` by trigger; the
  app also logs a readable line for each action (History).
- Scanner: any USB/Bluetooth keyboard-wedge scanner. Burst detection in `src/lib/logic/scan.js`;
  one scan = form number, space, serial.

## Commands

```
npm install       # once
npm run dev       # local development (demo mode without .env)
npm run build     # production build -> dist/
npm test          # logic + store tests, render checks, code guards
npm run deploy    # build for GitHub Pages (/BC-Inventory/) and publish via the .ghp worktree
```

## Roles

Role comes from the URL — one bookmark per person; a shared site password still gates entry.

| Link | Role | Can |
|---|---|---|
| `/?role=admin` | Admin | everything, incl. catalog values, costs and Settings |
| `/?role=floor` | Floor / Inventory | Purchase, Receive, Open, Inventory, Reports; fill blank catalog fields |
| `/?role=accountant` | Accountant | read everything, Reports, mark invoices paid |

Enforcement is in the app layer (as in the bingo app) — anyone with the admin link has admin.
Admin PIN (default **1234 — change it**) guards Settings and cost changes.
