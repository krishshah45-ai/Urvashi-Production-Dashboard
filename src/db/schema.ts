import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// One row per calendar date. This is the anchor every other table hangs off.
export const dailyReports = sqliteTable("daily_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  status: text("status", { enum: ["draft", "confirmed"] })
    .notNull()
    .default("draft"),
  notes: text("notes"), // freeform notes pulled from the MIS report (Note 1, Note 2, ...)
  uptodateProductionMt: real("uptodate_production_mt"),
  uptodatePowerUnits: real("uptodate_power_units"),
  solarGenerationUnits: real("solar_generation_units"), // typed in by hand — no source document for this yet
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const SHIFTS = ["A", "B", "C"] as const;
export type Shift = (typeof SHIFTS)[number];

// One row per (date, shift). Production, power, downtime, water, equipment hours.
export const shiftMetrics = sqliteTable("shift_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  shift: text("shift", { enum: SHIFTS }).notNull(),

  productionMt: real("production_mt"),

  paperMcUnits: real("paper_mc_units"),
  paperMcUpt: real("paper_mc_upt"), // units per ton
  vfdUnits: real("vfd_units"),
  vfdUpt: real("vfd_upt"),
  pulpMillUnits: real("pulp_mill_units"),
  pulpMillUpt: real("pulp_mill_upt"),
  boilerUnits: real("boiler_units"),
  boilerUpt: real("boiler_upt"),
  totalUnits: real("total_units"),
  totalUpt: real("total_upt"),

  // From the WhatsApp update — split by company/grid connection, not in the MIS sheet.
  urvashiGebUnits: real("urvashi_geb_units"),
  uppmGebUnits: real("uppm_geb_units"),

  downtimeProcessMin: real("downtime_process_min"),
  downtimeElectVfdMin: real("downtime_elect_vfd_min"),
  downtimePulpMillMin: real("downtime_pulp_mill_min"),
  downtimeBoilerMin: real("downtime_boiler_min"),
  downtimeMechMin: real("downtime_mech_min"),
  downtimeInstrumentationMin: real("downtime_instrumentation_min"),
  downtimeOthersMin: real("downtime_others_min"),
  downtimeTotalMin: real("downtime_total_min"),
  downtimeReason: text("downtime_reason"),

  waterGidcKl: real("water_gidc_kl"),
  waterBoilerKl: real("water_boiler_kl"),

  // { pulper, tdr21, tdr30, tdr26sf, tdr26lf, turbo } in decimal hours — kept as JSON
  // because which equipment appears varies day to day.
  equipmentHoursJson: text("equipment_hours_json"),

  pmcDrawTph: real("pmc_draw_tph"),
  pMillDrawTph: real("p_mill_draw_tph"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Paper grade output (Pine/RB, Cedar/DB, Teak/DB+, ...). shift = null means the daily total row.
export const gradeProduction = sqliteTable("grade_production", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  shift: text("shift", { enum: SHIFTS }),
  grade: text("grade").notNull(),
  qtyMt: real("qty_mt"),
  gsm: text("gsm"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Chemical stock/usage ledger. shift = null means the whole-day rollup sheet.
export const chemicalUsage = sqliteTable("chemical_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  shift: text("shift", { enum: SHIFTS }),
  chemicalName: text("chemical_name").notNull(),
  rateRsPerKg: real("rate_rs_per_kg"),
  openStockKg: real("open_stock_kg"),
  receivedQtyKg: real("received_qty_kg"),
  usedQtyKg: real("used_qty_kg"),
  meterUsedQtyKg: real("meter_used_qty_kg"),
  recipeQtyKg: real("recipe_qty_kg"),
  usePerTonKg: real("use_per_ton_kg"),
  closingStockKg: real("closing_stock_kg"),
  reorderLevelKg: real("reorder_level_kg"),
  costPerTonRs: real("cost_per_ton_rs"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Raw line items straight off the wastage sheet (multiple weigh-ins per day per category).
export const wastage = sqliteTable("wastage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  category: text("category", {
    enum: ["trim_waste", "broke_waste", "core_paper_waste"],
  }).notNull(),
  srNo: integer("sr_no"),
  weightKg: real("weight_kg").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Waste-paper (raw material) purchase, split by the two group companies.
export const rawMaterialPurchase = sqliteTable("raw_material_purchase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  company: text("company").notNull(), // "Urvashi" | "UPPM"
  dailyQtyMt: real("daily_qty_mt"),
  monthlyTotalMt: real("monthly_total_mt"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Every file a user uploads lands here first, holding the parser's raw output for
// review before it's committed into the typed tables above.
export const sourceUploads = sqliteTable("source_uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date").notNull(),
  sourceType: text("source_type", {
    enum: [
      "mis_xlsx",
      "whatsapp_text",
      "chemical_image",
      "shift_chemical_image",
      "wastage_image",
      "dispatch_attachment",
    ],
  }).notNull(),
  filename: text("filename").notNull(),
  rawExtractionJson: text("raw_extraction_json").notNull(),
  status: text("status", {
    enum: ["pending_review", "confirmed", "rejected"],
  })
    .notNull()
    .default("pending_review"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
});

// A flexible label/value bucket for attachments with no fixed layout yet (e.g. dispatch
// figures) — extracted best-effort by a generic parser rather than a schema-specific one.
export const miscFigures = sqliteTable("misc_figures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date")
    .notNull()
    .references(() => dailyReports.date, { onDelete: "cascade" }),
  sourceLabel: text("source_label").notNull(), // e.g. "dispatch"
  label: text("label").notNull(),
  value: real("value"),
  unit: text("unit"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
