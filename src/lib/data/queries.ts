import { db } from "@/db";
import {
  dailyReports,
  shiftMetrics,
  gradeProduction,
  chemicalUsage,
  wastage,
  rawMaterialPurchase,
  miscFigures,
} from "@/db/schema";
import { eq, gte, lte, desc, and } from "drizzle-orm";
import { SHIFTS, type Shift } from "./types";

export interface DailyReportFull {
  date: string;
  status: "draft" | "confirmed";
  notes: string | null;
  uptodateProductionMt: number | null;
  uptodatePowerUnits: number | null;
  solarGenerationUnits: number | null;
  shifts: (typeof shiftMetrics.$inferSelect)[];
  grades: (typeof gradeProduction.$inferSelect)[];
  chemicals: (typeof chemicalUsage.$inferSelect)[];
  wastage: (typeof wastage.$inferSelect)[];
  rawMaterial: (typeof rawMaterialPurchase.$inferSelect)[];
  miscFigures: (typeof miscFigures.$inferSelect)[];
}

export async function getReportByDate(date: string): Promise<DailyReportFull | null> {
  const report = await db.select().from(dailyReports).where(eq(dailyReports.date, date)).get();
  if (!report) return null;
  const [shifts, grades, chemicals, wastageRows, rawMaterial, miscFigureRows] = await Promise.all([
    db.select().from(shiftMetrics).where(eq(shiftMetrics.reportDate, date)).all(),
    db.select().from(gradeProduction).where(eq(gradeProduction.reportDate, date)).all(),
    db.select().from(chemicalUsage).where(eq(chemicalUsage.reportDate, date)).all(),
    db.select().from(wastage).where(eq(wastage.reportDate, date)).all(),
    db.select().from(rawMaterialPurchase).where(eq(rawMaterialPurchase.reportDate, date)).all(),
    db.select().from(miscFigures).where(eq(miscFigures.reportDate, date)).all(),
  ]);
  return { ...report, shifts, grades, chemicals, wastage: wastageRows, rawMaterial, miscFigures: miscFigureRows };
}

export async function listRecentReports(limit = 60) {
  return db.select().from(dailyReports).orderBy(desc(dailyReports.date)).limit(limit).all();
}

export async function listShiftMetricsInRange(startDate: string, endDate: string) {
  return db
    .select()
    .from(shiftMetrics)
    .where(and(gte(shiftMetrics.reportDate, startDate), lte(shiftMetrics.reportDate, endDate)))
    .all();
}

export interface DayTotals {
  date: string;
  productionMt: number;
  totalUnits: number;
  unitsPerTon: number | null;
  downtimeTotalMin: number;
  waterKl: number;
}

/** Rolls per-shift rows up to one totals row per day, for trend charts and MTD sums. */
export function summarizeByDay(rows: (typeof shiftMetrics.$inferSelect)[]): DayTotals[] {
  const byDate = new Map<string, DayTotals>();
  for (const r of rows) {
    const day = byDate.get(r.reportDate) ?? {
      date: r.reportDate,
      productionMt: 0,
      totalUnits: 0,
      unitsPerTon: null,
      downtimeTotalMin: 0,
      waterKl: 0,
    };
    day.productionMt += r.productionMt ?? 0;
    day.totalUnits += r.totalUnits ?? 0;
    day.downtimeTotalMin += r.downtimeTotalMin ?? 0;
    day.waterKl += (r.waterGidcKl ?? 0) + (r.waterBoilerKl ?? 0);
    byDate.set(r.reportDate, day);
  }
  for (const day of byDate.values()) {
    day.unitsPerTon = day.productionMt > 0 ? day.totalUnits / day.productionMt : null;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface RedFlag {
  severity: "warn" | "critical";
  message: string;
}

const BENCHMARK_UPT = 296; // observed daily average U/T from the sample day; a starting baseline until real history accumulates
const DOWNTIME_WARN_MIN = 60;
const DOWNTIME_CRITICAL_MIN = 120;

/** Simple threshold-based red flags for the latest day — refine the thresholds as real history accumulates. */
export function computeRedFlags(shifts: (typeof shiftMetrics.$inferSelect)[]): RedFlag[] {
  const flags: RedFlag[] = [];
  for (const shift of SHIFTS as readonly Shift[]) {
    const m = shifts.find((s) => s.shift === shift);
    if (!m) continue;
    if (m.downtimeTotalMin != null && m.downtimeTotalMin >= DOWNTIME_CRITICAL_MIN) {
      flags.push({
        severity: "critical",
        message: `Shift ${shift}: ${m.downtimeTotalMin} min downtime${m.downtimeReason ? ` — ${m.downtimeReason}` : ""}`,
      });
    } else if (m.downtimeTotalMin != null && m.downtimeTotalMin >= DOWNTIME_WARN_MIN) {
      flags.push({
        severity: "warn",
        message: `Shift ${shift}: ${m.downtimeTotalMin} min downtime${m.downtimeReason ? ` — ${m.downtimeReason}` : ""}`,
      });
    }
    if (m.totalUpt != null && m.totalUpt > BENCHMARK_UPT * 1.15) {
      flags.push({
        severity: "warn",
        message: `Shift ${shift}: power use ${m.totalUpt.toFixed(1)} units/MT, ${(
          ((m.totalUpt - BENCHMARK_UPT) / BENCHMARK_UPT) *
          100
        ).toFixed(0)}% above baseline`,
      });
    }
  }
  return flags;
}
