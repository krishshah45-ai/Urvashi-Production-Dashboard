import ExcelJS from "exceljs";
import type { ParseResult, ParsedDailyReportSlice } from "@/lib/data/types";
import { parseMillDate, toNum, toStr, normalizeLabel } from "./util";

/**
 * Parses the "Daily MIS/Flash Report" workbook — the one clean, positionally
 * stable source. Layout, confirmed against the 16.09.2026 sample:
 *
 *   Row w/ col A "Date"                -> col B: the report date
 *   Row w/ col A "Shift" + row w/ "Prod"-> production/power header (2-row)
 *     next 3 rows starting A/B/C       -> per-shift production + power + U/T
 *   Row w/ col A "Shift" + "Downtime"  -> downtime header (2-row)
 *     next 3 rows starting A/B/C       -> per-shift downtime minutes + reason
 *   Row containing "PMC Draw"          -> anchor for the MTD summary block:
 *     anchor+0 col K  -> uptodate production (MT)
 *     anchor+1 col K  -> uptodate power (units)              (also shift A's PMC/P.Mill draw)
 *     anchor+2..3 col K -> avg U/MT, avg daily production     (shift B/C's draw row)
 *   Rows starting "Note"               -> freeform engineer notes
 *
 * Everything here is read positionally within each block (not by fixed absolute
 * row numbers), so the parser tolerates the notes section growing/shrinking day
 * to day, which is the only part of this sheet that isn't a fixed template.
 */
export async function parseMisReport(buffer: Buffer): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts redeclares a global `Buffer extends ArrayBuffer`, which conflicts
  // with @types/node's Buffer under the esnext lib — a known upstream typing bug, hence `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { slice: {}, warnings: [{ message: "Workbook has no sheets." }] };
  }

  const rowCount = sheet.actualRowCount || sheet.rowCount;
  const grid: string[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    const maxCol = Math.max(row.actualCellCount, 14);
    for (let c = 1; c <= maxCol; c++) {
      cells.push(toStr(row.getCell(c).value));
    }
    grid.push(cells);
  }
  const get = (r: number, c: number): string => grid[r]?.[c] ?? "";
  const num = (r: number, c: number): number | undefined => toNum(sheet.getRow(r + 1).getCell(c + 1).value);

  const slice: ParsedDailyReportSlice = {
    shiftMetrics: {},
    notes: [],
  };

  // --- Date ---
  const dateRowIdx = grid.findIndex((row) => normalizeLabel(row[0] || "") === "date");
  if (dateRowIdx >= 0) {
    const parsed = parseMillDate(get(dateRowIdx, 1));
    if (parsed) slice.date = parsed;
    else warnings.push({ message: `Could not parse date value "${get(dateRowIdx, 1)}".` });
  } else {
    warnings.push({ message: 'No "Date" row found in the MIS sheet.' });
  }

  // --- Production / power table ---
  const prodHeaderIdx = grid.findIndex(
    (row) => normalizeLabel(row[0] || "").startsWith("shift") && row.some((c) => normalizeLabel(c).includes("prod"))
  );
  if (prodHeaderIdx >= 0) {
    let found = 0;
    for (let r = prodHeaderIdx + 1; r < Math.min(prodHeaderIdx + 8, grid.length) && found < 3; r++) {
      const label = get(r, 0).trim().toUpperCase();
      const shift = (["A", "B", "C"] as const).find((s) => label.startsWith(s));
      if (!shift) continue;
      found++;
      slice.shiftMetrics![shift] = {
        ...slice.shiftMetrics![shift],
        shift,
        productionMt: num(r, 1),
        paperMcUnits: num(r, 2),
        paperMcUpt: num(r, 3),
        vfdUnits: num(r, 4),
        vfdUpt: num(r, 5),
        pulpMillUnits: num(r, 6),
        pulpMillUpt: num(r, 7),
        boilerUnits: num(r, 8),
        boilerUpt: num(r, 9),
        totalUnits: num(r, 10),
        totalUpt: num(r, 11),
      };
    }
    if (found < 3) warnings.push({ message: `Only found ${found}/3 shift rows in the production table.` });
  } else {
    warnings.push({ message: "Could not locate the production/power table (no 'Shift'+'Prod' header)." });
  }

  // --- Downtime table ---
  const dtHeaderIdx = grid.findIndex(
    (row) => normalizeLabel(row[0] || "").startsWith("shift") && row.some((c) => normalizeLabel(c).includes("downtime"))
  );
  if (dtHeaderIdx >= 0) {
    let found = 0;
    for (let r = dtHeaderIdx + 1; r < Math.min(dtHeaderIdx + 8, grid.length) && found < 3; r++) {
      const label = get(r, 0).trim().toUpperCase();
      const shift = (["A", "B", "C"] as const).find((s) => label.startsWith(s));
      if (!shift) continue;
      found++;
      const reasonRaw = get(r, 9);
      const reason = reasonRaw.replace(/^[ABC]\s*[:.]\s*/i, "").trim();
      slice.shiftMetrics![shift] = {
        ...slice.shiftMetrics![shift],
        shift,
        downtimeProcessMin: num(r, 1),
        downtimeElectVfdMin: num(r, 2),
        downtimePulpMillMin: num(r, 3),
        downtimeBoilerMin: num(r, 4),
        downtimeMechMin: num(r, 5),
        downtimeInstrumentationMin: num(r, 6),
        downtimeOthersMin: num(r, 7),
        downtimeTotalMin: num(r, 8),
        downtimeReason: reason || undefined,
      };
    }
    if (found < 3) warnings.push({ message: `Only found ${found}/3 shift rows in the downtime table.` });
  } else {
    warnings.push({ message: "Could not locate the downtime table." });
  }

  // --- MTD summary block (PMC Draw anchor) ---
  const pmcAnchorIdx = grid.findIndex((row) => row.some((c) => normalizeLabel(c).includes("pmc draw")));
  if (pmcAnchorIdx >= 0) {
    slice.uptodateProductionMt = num(pmcAnchorIdx, 10);
    slice.uptodatePowerUnits = num(pmcAnchorIdx + 1, 10);

    // Shift A/B/C draw rows sit at anchor+1..+3; pick up PMC/P.Mill draw (tph) per shift.
    for (let i = 1; i <= 3; i++) {
      const r = pmcAnchorIdx + i;
      const label = get(r, 0).trim().toUpperCase();
      const shift = (["A", "B", "C"] as const).find((s) => label.startsWith(s));
      if (!shift) continue;
      slice.shiftMetrics![shift] = {
        ...slice.shiftMetrics![shift],
        shift,
        pmcDrawTph: num(r, 1),
        pMillDrawTph: num(r, 2),
      };
    }
  } else {
    warnings.push({ message: "Could not locate the 'PMC Draw' / uptodate-production summary block." });
  }

  // --- Whole-day water figure, e.g. "Water: 112 KL" (cross-check against WhatsApp per-shift water) ---
  for (const row of grid) {
    for (const cell of row) {
      const m = cell.match(/water\s*:?\s*([\d.]+)\s*kl/i);
      if (m) {
        slice.notes!.push(`MIS sheet whole-day water: ${m[1]} KL (cross-check vs. shift-wise water)`);
      }
    }
  }

  // --- Freeform engineer notes ---
  for (const row of grid) {
    const c0 = row[0] || "";
    if (/^note\s*\d/i.test(c0.trim())) {
      slice.notes!.push(c0.trim());
    }
  }

  slice.notes = Array.from(new Set(slice.notes));
  if (slice.notes!.length === 0) delete slice.notes;

  return { slice, warnings };
}
