import type { ParsedDailyReportSlice, ParsedShiftMetrics } from "./types";
import { SHIFTS } from "./types";

export interface FieldConflict {
  path: string;
  values: { source: string; value: unknown }[];
}

/**
 * Merges parsed slices from multiple uploaded sources into one draft report.
 * Sources are merged in the order given — a later source only fills fields the
 * earlier ones left blank, EXCEPT numeric fields that both sources report,
 * which are flagged as conflicts for the review screen instead of silently
 * picked, since a MIS-vs-WhatsApp mismatch on production or power usually
 * means one of them was mistyped.
 */
export function mergeSlices(
  sources: { name: string; slice: ParsedDailyReportSlice }[]
): { merged: ParsedDailyReportSlice; conflicts: FieldConflict[] } {
  const merged: ParsedDailyReportSlice = { shiftMetrics: {} };
  const conflicts: FieldConflict[] = [];

  for (const { name, slice } of sources) {
    if (slice.date) {
      if (merged.date && merged.date !== slice.date) {
        conflicts.push({
          path: "date",
          values: [
            { source: "existing", value: merged.date },
            { source: name, value: slice.date },
          ],
        });
      } else {
        merged.date = slice.date;
      }
    }

    if (slice.notes?.length) {
      merged.notes = [...(merged.notes ?? []), ...slice.notes];
    }

    if (slice.uptodateProductionMt != null) merged.uptodateProductionMt ??= slice.uptodateProductionMt;
    if (slice.uptodatePowerUnits != null) merged.uptodatePowerUnits ??= slice.uptodatePowerUnits;
    if (slice.solarGenerationUnits != null) merged.solarGenerationUnits ??= slice.solarGenerationUnits;

    for (const shift of SHIFTS) {
      const incoming = slice.shiftMetrics?.[shift];
      if (!incoming) continue;
      const existing = merged.shiftMetrics![shift] ?? { shift };
      for (const [key, value] of Object.entries(incoming)) {
        if (value == null) continue;
        const existingValue = (existing as Record<string, unknown>)[key];
        if (key === "equipmentHours") {
          (existing as Record<string, unknown>).equipmentHours = {
            ...((existingValue as object) ?? {}),
            ...(value as object),
          };
          continue;
        }
        if (existingValue == null) {
          (existing as Record<string, unknown>)[key] = value;
        } else if (typeof value === "number" && typeof existingValue === "number") {
          if (Math.abs(value - existingValue) > Math.max(1, Math.abs(existingValue) * 0.02)) {
            conflicts.push({
              path: `shift ${shift}.${key}`,
              values: [
                { source: "existing", value: existingValue },
                { source: name, value },
              ],
            });
          }
          // within tolerance: keep the first-seen value, source order = priority
        }
        // strings (e.g. downtimeReason) from an earlier, higher-priority source win silently
      }
      merged.shiftMetrics![shift] = existing as Partial<ParsedShiftMetrics>;
    }

    if (slice.gradeProduction?.length) {
      merged.gradeProduction = [...(merged.gradeProduction ?? []), ...slice.gradeProduction];
    }
    if (slice.chemicalUsage?.length) {
      merged.chemicalUsage = [...(merged.chemicalUsage ?? []), ...slice.chemicalUsage];
    }
    if (slice.wastage?.length) {
      merged.wastage = [...(merged.wastage ?? []), ...slice.wastage];
    }
    if (slice.rawMaterialPurchase?.length) {
      merged.rawMaterialPurchase = [...(merged.rawMaterialPurchase ?? []), ...slice.rawMaterialPurchase];
    }
    if (slice.miscFigures?.length) {
      merged.miscFigures = [...(merged.miscFigures ?? []), ...slice.miscFigures];
    }
  }

  return { merged, conflicts };
}
