export const SHIFTS = ["A", "B", "C"] as const;
export type Shift = (typeof SHIFTS)[number];

export interface ParsedShiftMetrics {
  shift: Shift;
  productionMt?: number;

  paperMcUnits?: number;
  paperMcUpt?: number;
  vfdUnits?: number;
  vfdUpt?: number;
  pulpMillUnits?: number;
  pulpMillUpt?: number;
  boilerUnits?: number;
  boilerUpt?: number;
  totalUnits?: number;
  totalUpt?: number;

  urvashiGebUnits?: number;
  uppmGebUnits?: number;

  downtimeProcessMin?: number;
  downtimeElectVfdMin?: number;
  downtimePulpMillMin?: number;
  downtimeBoilerMin?: number;
  downtimeMechMin?: number;
  downtimeInstrumentationMin?: number;
  downtimeOthersMin?: number;
  downtimeTotalMin?: number;
  downtimeReason?: string;

  waterGidcKl?: number;
  waterBoilerKl?: number;

  equipmentHours?: Record<string, number>;

  pmcDrawTph?: number;
  pMillDrawTph?: number;
}

export interface ParsedGradeProduction {
  shift: Shift | null;
  grade: string;
  qtyMt?: number;
  gsm?: string;
}

export interface ParsedChemicalUsage {
  shift: Shift | null;
  chemicalName: string;
  rateRsPerKg?: number;
  openStockKg?: number;
  receivedQtyKg?: number;
  usedQtyKg?: number;
  meterUsedQtyKg?: number;
  recipeQtyKg?: number;
  usePerTonKg?: number;
  closingStockKg?: number;
  reorderLevelKg?: number;
  costPerTonRs?: number;
}

export interface ParsedWastageItem {
  category: "trim_waste" | "broke_waste" | "core_paper_waste";
  srNo?: number;
  weightKg: number;
}

export interface ParsedRawMaterialPurchase {
  company: string;
  dailyQtyMt?: number;
  monthlyTotalMt?: number;
}

// What every parser produces — a partial slice of one day's report.
// The upload flow merges slices from multiple sources before it's reviewed & committed.
export interface ParsedDailyReportSlice {
  date?: string; // YYYY-MM-DD, when the source can tell us
  notes?: string[];
  uptodateProductionMt?: number;
  uptodatePowerUnits?: number;
  shiftMetrics?: Partial<Record<Shift, Partial<ParsedShiftMetrics>>>;
  gradeProduction?: ParsedGradeProduction[];
  chemicalUsage?: ParsedChemicalUsage[];
  wastage?: ParsedWastageItem[];
  rawMaterialPurchase?: ParsedRawMaterialPurchase[];
}

export interface ParseWarning {
  message: string;
}

export interface ParseResult {
  slice: ParsedDailyReportSlice;
  warnings: ParseWarning[];
}
