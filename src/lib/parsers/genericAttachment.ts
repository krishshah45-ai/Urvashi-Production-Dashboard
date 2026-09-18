import ExcelJS from "exceljs";
import type { ParseResult, ParsedDailyReportSlice, ParsedMiscFigure } from "@/lib/data/types";
import { toNum, toStr } from "./util";

/**
 * For attachments with no fixed layout yet (currently: dispatch figures — no
 * sample has been seen, so there's no positional parser like the MIS sheet
 * has). This scans for "label, then a number" pairs rather than assuming any
 * particular columns, and is meant to be a starting point: once a real sample
 * shows up, replace it with a parser like misReport.ts's, the same way the
 * other reports work.
 */

/** Row-oriented spreadsheets: label in one cell, its number in the next non-empty cell of the same row. */
export async function parseGenericSpreadsheet(buffer: Buffer, sourceLabel: string): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (err) {
    return { slice: {}, warnings: [{ message: `Could not read spreadsheet: ${(err as Error).message}` }] };
  }

  const figures: ParsedMiscFigure[] = [];
  const sheet = workbook.worksheets[0];
  if (sheet) {
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map(toStr);
      for (let i = 0; i < cells.length - 1; i++) {
        const label = cells[i];
        if (!label || /^[\d.]+$/.test(label)) continue;
        const value = toNum(cells[i + 1]);
        if (value === undefined) continue;
        const unit = cells[i + 2] && !toNum(cells[i + 2]) ? cells[i + 2] : undefined;
        figures.push({ sourceLabel, label, value, unit });
        break; // one label:value pair per row is the common case for these hand sheets
      }
    });
  }

  const slice: ParsedDailyReportSlice = figures.length ? { miscFigures: figures } : {};
  if (figures.length === 0) {
    warnings.push({
      message: `No label/value pairs found automatically in this ${sourceLabel} spreadsheet — add figures manually in the review draft.`,
    });
  }
  return { slice, warnings };
}

/** Plain text / CSV: one "label - value" or "label: value" pair per line. */
export function parseGenericText(text: string, sourceLabel: string): ParseResult {
  const warnings: ParseResult["warnings"] = [];
  const figures: ParsedMiscFigure[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().replace(/,/g, "");
    if (!line) continue;
    const m = line.match(/^(.+?)[\s,:-]+([\d.]+)\s*([a-zA-Z%/]*)\s*$/);
    if (!m) continue;
    const [, label, valueStr, unit] = m;
    const value = toNum(valueStr);
    if (value === undefined) continue;
    figures.push({ sourceLabel, label: label.trim(), value, unit: unit || undefined });
  }

  const slice: ParsedDailyReportSlice = figures.length ? { miscFigures: figures } : {};
  if (figures.length === 0) {
    warnings.push({
      message: `No "label: value" lines found in this ${sourceLabel} attachment — add figures manually in the review draft.`,
    });
  }
  return { slice, warnings };
}
