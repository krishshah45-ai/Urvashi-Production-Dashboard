import mammoth from "mammoth";
import type { ParseResult, ParsedDailyReportSlice, Shift } from "@/lib/data/types";
import { parseMillDate, toNum, hhmmToDecimalHours } from "./util";

const SHIFTS: Shift[] = ["A", "B", "C"];

/**
 * Parses the free-text WhatsApp shift updates. Unlike the MIS sheet, this has
 * no fixed cell grid — it's copy-pasted text that drifts slightly day to day —
 * so this is regex-over-lines rather than positional. It cross-reports several
 * numbers already in the MIS sheet (production, department units) — those are
 * kept here so the upload/merge step can flag discrepancies — plus a few
 * numbers found nowhere else: the Urvashi/UPPM GEB (grid) split, equipment
 * running hours, per-shift water, and raw-material (waste paper) purchases.
 *
 * Document shape, confirmed against the 16.09.2026 sample:
 *   1) / 2) / 3)  -- one block per shift (A/B/C), each a "*Shift- X" line
 *                    followed by ~20 "Label - value" lines
 *   4)            -- three "DATE-... SHIFT- X" sub-blocks with Gidc water / Boiler
 *   5)            -- one paragraph with waste-paper purchase per group company
 */
export async function parseWhatsappUpdate(buffer: Buffer): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const slice: ParsedDailyReportSlice = { shiftMetrics: {}, rawMaterialPurchase: [] };

  const ensureShift = (s: Shift) => {
    if (!slice.shiftMetrics![s]) slice.shiftMetrics![s] = { shift: s };
    return slice.shiftMetrics![s]!;
  };

  let currentShift: Shift | null = null;
  let section: 1 | 4 | 5 = 1;
  let awaitingDowntimeReason = false;

  const numMatch = (line: string, re: RegExp): number | undefined => {
    const m = line.match(re);
    return m ? toNum(m[1]) : undefined;
  };

  for (const line of lines) {
    if (!slice.date) {
      const dm = line.match(/date\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (dm) {
        const parsed = parseMillDate(dm[1]);
        if (parsed) slice.date = parsed;
      }
    }

    if (/^4\)/.test(line)) {
      section = 4;
      currentShift = null;
      continue;
    }
    if (/^5\)/.test(line)) {
      section = 5;
      currentShift = null;
      continue;
    }

    const shiftMatch = line.match(/shift\s*-\s*([ABC])\b/i);
    if (shiftMatch) {
      currentShift = shiftMatch[1].toUpperCase() as Shift;
      ensureShift(currentShift);
      awaitingDowntimeReason = false;
      continue;
    }

    if (section === 5) {
      const re =
        /([A-Za-z]+)\s*\(company\s*\d+\)\s*indian\s*waste\s*paper\s*purchase\.?\s*:\s*[\d./]+\s*:\s*([\d.]+)\s*mt\s*:\s*monthly\s*total\s*:\s*([\d.]+)\s*mt/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        slice.rawMaterialPurchase!.push({
          company: m[1],
          dailyQtyMt: toNum(m[2]),
          monthlyTotalMt: toNum(m[3]),
        });
      }
      continue;
    }

    if (!currentShift) continue;
    const shiftData = ensureShift(currentShift);

    if (section === 4) {
      const gidc = line.match(/gidc\s*water\s*[-:]?\s*([\d.]+)/i);
      if (gidc) {
        shiftData.waterGidcKl = toNum(gidc[1]);
        continue;
      }
      const boilerWater = line.match(/^boiler\s*[-:]?\s*([\d.]+)\s*$/i);
      if (boilerWater) {
        shiftData.waterBoilerKl = toNum(boilerWater[1]);
        continue;
      }
      continue;
    }

    // section 1: per-shift full report
    if (awaitingDowntimeReason) {
      awaitingDowntimeReason = false;
      if (!/^\d\)/.test(line) && !/date\s*-/i.test(line) && !/shift\s*-/i.test(line)) {
        shiftData.downtimeReason = line.replace(/\.+$/, "").replace(/\s+/g, " ").trim();
      }
      continue;
    }

    let v: number | undefined;
    if ((v = numMatch(line, /m\/?c\s*production\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.productionMt = v;
      continue;
    }
    if ((v = numMatch(line, /urvashi\s*geb\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.urvashiGebUnits = v;
      continue;
    }
    if ((v = numMatch(line, /uppm\s*geb\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.uppmGebUnits = v;
      continue;
    }
    if ((v = numMatch(line, /pulpmill\s*unit\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.pulpMillUnits = v;
      continue;
    }
    if ((v = numMatch(line, /paper\s*m\/?c\s*vfd\s*unit\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.vfdUnits = v;
      continue;
    }
    if ((v = numMatch(line, /machine\s*unit\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.paperMcUnits = v;
      continue;
    }
    if ((v = numMatch(line, /boiler\s*unit\s*[-:]?\s*([\d.]+)/i)) !== undefined) {
      shiftData.boilerUnits = v;
      continue;
    }

    const eqPatterns: [string, RegExp][] = [
      ["pulper", /pulper\s*[-:]?\s*([\d.:]+)\s*hrs?/i],
      ["tdr21", /tdr\s*21\s*"?\s*[-:]?\s*([\d.:]+)\s*hrs?/i],
      ["tdr30", /tdr\s*30\s*"?\s*[-:]?\s*([\d.:]+)\s*hrs?/i],
      ["tdr26sf", /new\s*tdr\s*26\s*"?\s*sf\s*[-:]?\s*([\d.:]+)\s*hrs?/i],
      ["tdr26lf", /new\s*tdr\s*26\s*"?\s*l\.?f\.?\s*[-:]?\s*([\d.:]+)\s*hrs?/i],
      ["turbo", /turbo\b[^\d]*([\d.:]+)/i],
    ];
    let matchedEquipment = false;
    for (const [key, re] of eqPatterns) {
      const m = line.match(re);
      if (m) {
        const hrs = hhmmToDecimalHours(m[0]) ?? toNum(m[1]);
        if (hrs !== undefined) {
          shiftData.equipmentHours = { ...(shiftData.equipmentHours ?? {}), [key]: hrs };
        }
        matchedEquipment = true;
        break;
      }
    }
    if (matchedEquipment) continue;

    const dt = line.match(/down\s*time\s*[-:]?\s*([\d.:]+)\s*hrs?/i);
    if (dt) {
      const hrs = hhmmToDecimalHours(dt[0]) ?? toNum(dt[1]);
      if (hrs !== undefined) shiftData.downtimeTotalMin = Math.round(hrs * 60);
      awaitingDowntimeReason = true;
      continue;
    }
  }

  for (const s of SHIFTS) {
    if (!slice.shiftMetrics![s]) {
      warnings.push({ message: `No data found for Shift ${s} in the WhatsApp update.` });
    }
  }
  if (!slice.rawMaterialPurchase || slice.rawMaterialPurchase.length === 0) {
    warnings.push({ message: "Could not find the waste-paper purchase paragraph (section 5)." });
    delete slice.rawMaterialPurchase;
  }
  if (!slice.date) {
    warnings.push({ message: "Could not parse a date from the WhatsApp update." });
  }

  return { slice, warnings };
}
