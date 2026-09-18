# Urvashi Production Dashboard

A daily production dashboard for Urvashi Pulp & Paper Mill. Upload the day's
reports (a few Excel sheets, a WhatsApp text export, a few photos), and it
compiles them into one record: production, power, downtime, water, chemical
usage/cost, wastage, and raw-material purchases — plus month-to-date totals
and simple red-flag alerts, in a terminal-style dashboard.

## How it works

Seven inputs make up one day's report:

| Source | Format | Parsed by |
|---|---|---|
| Daily MIS / Flash Report | `.xlsx` upload | positional cell parser (`src/lib/parsers/misReport.ts`) — the layout is a fixed template, confirmed against a real sample |
| WhatsApp shift updates | pasted text | regex-over-text parser (`src/lib/parsers/whatsappUpdate.ts`, `parseWhatsappText`) — paste straight from the chat, no file/conversion step; no fixed grid, so it matches on labels |
| Chemical Report | photo | Claude vision, forced to a strict JSON schema (`src/lib/parsers/imageExtraction.ts`) |
| Shift-wise Chemical Report | photo | same, per-shift schema |
| Wastage Report | photo | same, trim/broke/core schema |
| Dispatch figures | any attachment | generic label/value extractor (`src/lib/parsers/genericAttachment.ts` for spreadsheets/text, `parseGenericFiguresImage` for photos) — no known layout yet, so this is best-effort; replace with a schema-specific parser once a real sample is seen, the same way the other reports work |
| Solar generation | typed number | no document exists for this yet — a plain input field, merged straight into the draft |

Each parser returns a **slice** of the day (some fields, not all). The upload
flow merges the slices, flags any two sources that disagree on the same
number by more than 2%, and shows the whole thing as an **editable draft**
before anything is written to the database — this matters most for the photo
sources and the dispatch attachment, since a misread digit there is real money.

Two sources (MIS + WhatsApp) redundantly report several of the same numbers
(production, department power units) under different names — that's used as
a built-in cross-check, not just noise.

## Local development

```bash
npm install
npx drizzle-kit push   # creates ./local.db (SQLite) — no other setup needed
npm run dev
```

Open http://localhost:3000. Photo parsing (chemical/shift-chemical/wastage
reports, and a photographed dispatch attachment) needs `ANTHROPIC_API_KEY` set
in `.env.local` — see `.env.example`. Without it, the MIS xlsx upload, pasted
WhatsApp text, spreadsheet/text dispatch attachments, and the solar generation
field all still work fully; photo uploads will return a parser error that
shows up as a warning on the review screen instead of crashing the upload.

## Deploying (Vercel)

1. Push this repo to GitHub and import it in Vercel.
2. Create a free database at [turso.tech](https://turso.tech) (SQLite-compatible,
   works unmodified with the same driver used locally). Set on Vercel:
   - `DATABASE_URL` — your `libsql://...` URL
   - `DATABASE_AUTH_TOKEN` — its auth token
   - `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com/settings/keys), for photo parsing
3. Run `npx drizzle-kit push` once locally against the production `DATABASE_URL`
   (or from a one-off Vercel deploy step) to create the tables.
4. Deploy.

## Data model

`src/db/schema.ts` — one `daily_reports` row per date (now including
`solar_generation_units`, typed in by hand), with child tables for
`shift_metrics` (A/B/C production, power, downtime, water, equipment hours),
`grade_production`, `chemical_usage`, `wastage`, `raw_material_purchase`, and
`misc_figures` (the flexible label/value bucket dispatch figures land in,
until a real sample lets us give it a proper schema). Every upload also lands
in `source_uploads` as an audit trail of what was parsed from which file.

## What's next

- **Dispatch figures** are parsed generically right now (best-effort label:
  value matching) because no real sample of that report has been seen yet.
  Once you share one, swap `genericAttachment.ts` for a positional parser
  like `misReport.ts` — much more reliable, same pattern as everything else.
- **Sales, packing material consumption, inventory in/out** — mentioned as
  future sources. Once you have a sample of each, the same pattern applies:
  a new parser + a new table + a merge into the daily slice.
- **Red-flag thresholds** (`src/lib/data/queries.ts`, `computeRedFlags`) are
  currently a single hardcoded baseline (296 units/MT, from the one sample
  day) — worth replacing with a rolling trailing-30-day average once more
  days are on record.
- **Review UI** is currently a single editable JSON blob per upload — functional,
  but a structured per-field form (especially for the chemical ledger) would
  be faster to correct on a bad photo scan.
- The `xlsx` npm package has known unpatched vulnerabilities (prototype
  pollution / ReDoS) in its published-to-npm build, so this project uses
  `exceljs` instead.
