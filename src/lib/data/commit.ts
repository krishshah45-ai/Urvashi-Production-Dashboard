import { db } from "@/db";
import {
  dailyReports,
  shiftMetrics,
  gradeProduction,
  chemicalUsage,
  wastage,
  rawMaterialPurchase,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ParsedDailyReportSlice } from "./types";
import { SHIFTS } from "./types";

/** Writes a reviewed/confirmed daily slice into the typed tables, replacing any prior draft for that date. */
export async function commitReport(date: string, slice: ParsedDailyReportSlice): Promise<void> {
  const existing = await db.select().from(dailyReports).where(eq(dailyReports.date, date)).get();

  if (existing) {
    await db
      .update(dailyReports)
      .set({
        status: "confirmed",
        notes: slice.notes?.join("\n") ?? existing.notes,
        uptodateProductionMt: slice.uptodateProductionMt ?? existing.uptodateProductionMt,
        uptodatePowerUnits: slice.uptodatePowerUnits ?? existing.uptodatePowerUnits,
        updatedAt: new Date(),
      })
      .where(eq(dailyReports.date, date))
      .run();
  } else {
    await db
      .insert(dailyReports)
      .values({
        date,
        status: "confirmed",
        notes: slice.notes?.join("\n"),
        uptodateProductionMt: slice.uptodateProductionMt,
        uptodatePowerUnits: slice.uptodatePowerUnits,
      })
      .run();
  }

  // Replace-all for child tables keeps re-uploads/corrections idempotent.
  await db.delete(shiftMetrics).where(eq(shiftMetrics.reportDate, date)).run();
  await db.delete(gradeProduction).where(eq(gradeProduction.reportDate, date)).run();
  await db.delete(chemicalUsage).where(eq(chemicalUsage.reportDate, date)).run();
  await db.delete(wastage).where(eq(wastage.reportDate, date)).run();
  await db.delete(rawMaterialPurchase).where(eq(rawMaterialPurchase.reportDate, date)).run();

  for (const shift of SHIFTS) {
    const m = slice.shiftMetrics?.[shift];
    if (!m) continue;
    await db
      .insert(shiftMetrics)
      .values({
        reportDate: date,
        shift,
        productionMt: m.productionMt,
        paperMcUnits: m.paperMcUnits,
        paperMcUpt: m.paperMcUpt,
        vfdUnits: m.vfdUnits,
        vfdUpt: m.vfdUpt,
        pulpMillUnits: m.pulpMillUnits,
        pulpMillUpt: m.pulpMillUpt,
        boilerUnits: m.boilerUnits,
        boilerUpt: m.boilerUpt,
        totalUnits: m.totalUnits,
        totalUpt: m.totalUpt,
        urvashiGebUnits: m.urvashiGebUnits,
        uppmGebUnits: m.uppmGebUnits,
        downtimeProcessMin: m.downtimeProcessMin,
        downtimeElectVfdMin: m.downtimeElectVfdMin,
        downtimePulpMillMin: m.downtimePulpMillMin,
        downtimeBoilerMin: m.downtimeBoilerMin,
        downtimeMechMin: m.downtimeMechMin,
        downtimeInstrumentationMin: m.downtimeInstrumentationMin,
        downtimeOthersMin: m.downtimeOthersMin,
        downtimeTotalMin: m.downtimeTotalMin,
        downtimeReason: m.downtimeReason,
        waterGidcKl: m.waterGidcKl,
        waterBoilerKl: m.waterBoilerKl,
        equipmentHoursJson: m.equipmentHours ? JSON.stringify(m.equipmentHours) : undefined,
        pmcDrawTph: m.pmcDrawTph,
        pMillDrawTph: m.pMillDrawTph,
      })
      .run();
  }

  if (slice.gradeProduction?.length) {
    for (const g of slice.gradeProduction) {
      await db
        .insert(gradeProduction)
        .values({ reportDate: date, shift: g.shift, grade: g.grade, qtyMt: g.qtyMt, gsm: g.gsm })
        .run();
    }
  }

  if (slice.chemicalUsage?.length) {
    for (const c of slice.chemicalUsage) {
      await db
        .insert(chemicalUsage)
        .values({
          reportDate: date,
          shift: c.shift,
          chemicalName: c.chemicalName,
          rateRsPerKg: c.rateRsPerKg,
          openStockKg: c.openStockKg,
          receivedQtyKg: c.receivedQtyKg,
          usedQtyKg: c.usedQtyKg,
          meterUsedQtyKg: c.meterUsedQtyKg,
          recipeQtyKg: c.recipeQtyKg,
          usePerTonKg: c.usePerTonKg,
          closingStockKg: c.closingStockKg,
          reorderLevelKg: c.reorderLevelKg,
          costPerTonRs: c.costPerTonRs,
        })
        .run();
    }
  }

  if (slice.wastage?.length) {
    for (const w of slice.wastage) {
      await db
        .insert(wastage)
        .values({ reportDate: date, category: w.category, srNo: w.srNo, weightKg: w.weightKg })
        .run();
    }
  }

  if (slice.rawMaterialPurchase?.length) {
    for (const r of slice.rawMaterialPurchase) {
      await db
        .insert(rawMaterialPurchase)
        .values({
          reportDate: date,
          company: r.company,
          dailyQtyMt: r.dailyQtyMt,
          monthlyTotalMt: r.monthlyTotalMt,
        })
        .run();
    }
  }
}
