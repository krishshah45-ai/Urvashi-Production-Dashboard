import Anthropic from "@anthropic-ai/sdk";
import type {
  ParseResult,
  ParsedDailyReportSlice,
  ParsedChemicalUsage,
  ParsedGradeProduction,
  ParsedMiscFigure,
  ParsedWastageItem,
  Shift,
} from "@/lib/data/types";
import { parseMillDate } from "./util";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/**
 * Chemical/shift-chemical/wastage reports only exist as camera photos of a
 * printed or on-screen sheet, not real spreadsheet files — so unlike the MIS
 * and WhatsApp parsers, these can't be read positionally. This asks Claude's
 * vision to read the photo against a schema matched to the exact columns
 * these sheets use (confirmed against the 16.09.2026 samples), and always
 * routes the result through the upload review screen before it's trusted,
 * since a misread digit here is real money (chemical cost variance).
 */

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Report-photo parsing needs it — see .env.example."
    );
  }
  return new Anthropic({ apiKey });
}

async function extractViaTool<T>(params: {
  imageBase64: string;
  mediaType: ImageMediaType;
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Tool.InputSchema;
}): Promise<T> {
  const client = getClient();
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: params.systemPrompt,
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: params.inputSchema,
      },
    ],
    tool_choice: { type: "tool", name: params.toolName },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: params.mediaType, data: params.imageBase64 },
          },
          {
            type: "text",
            text: "Extract the data from this report photo exactly per the tool's schema. If a cell is illegible, cropped out, or blank in the photo, omit that field rather than guessing a value.",
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Model did not return structured data for this image.");
  return toolUse.input as T;
}

const GRADE_NAMES = [
  "Pine/RB",
  "Cedar/DB",
  "Teak/DB+",
  "Oak/PB",
  "FD+",
  "Maple/FD",
  "Mahogany/TB",
  "Ivory/TB+",
];

// --- Chemical Report (whole-day rollup: stock ledger + grade totals) ---

interface ChemicalReportExtraction {
  date?: string;
  chemicals: Array<{
    name: string;
    rateRsPerKg?: number;
    openStockKg?: number;
    receivedQtyKg?: number;
    usedQtyKg?: number;
    asPerFlowMeterUsedQtyKg?: number;
    qtyAsPerRecipeKg?: number;
    usePerTonPaperKg?: number;
    closingStockKg?: number;
    reorderStockLevelKg?: number;
  }>;
  gradeProductionToday?: Array<{ grade: string; qtyMt?: number }>;
}

export async function parseChemicalReportImage(
  imageBase64: string,
  mediaType: ImageMediaType
): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const inputSchema: Anthropic.Tool.InputSchema = {
    type: "object",
    properties: {
      date: { type: "string", description: "Report date exactly as printed, e.g. 16-09.2026" },
      chemicals: {
        type: "array",
        description:
          "One row per PARTICULARS in the chemical stock/usage table (PAC, FINOR DIFOAMER, N.T.P.D, IVAX RTN 102, IVAX AF105, hypo, G M F, BLUEMATE-413, CWT-3014, HCL, Finor OX-425, TAPIOCA STARCH, BIND FORCE, NATIVE STARCH, Arya chemical, AQUA BOOSTER 202, etc — use whatever names are printed).",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            rateRsPerKg: { type: "number", description: "RATE (Rs/Kg) column" },
            openStockKg: { type: "number", description: "OPEN STOCK (Kg) column" },
            receivedQtyKg: { type: "number", description: "RECEIVE QTY (Kg) column" },
            usedQtyKg: { type: "number", description: "USED QTY (Kg) column" },
            asPerFlowMeterUsedQtyKg: { type: "number", description: "AS PER FLOW METER USED QTY (Kg) column" },
            qtyAsPerRecipeKg: { type: "number", description: "QTY AS PER RECIPE (Kg) column" },
            usePerTonPaperKg: { type: "number", description: "USE-(Kg)/TON PAPER column" },
            closingStockKg: { type: "number", description: "CLOSING STOCK Kg column" },
            reorderStockLevelKg: { type: "number", description: "Re-order stock level (Kgs) column" },
          },
          required: ["name"],
        },
      },
      gradeProductionToday: {
        type: "array",
        description: `The "Today" column of the small Grade table (grades like ${GRADE_NAMES.join(", ")}), NOT the "Upto date" column.`,
        items: {
          type: "object",
          properties: { grade: { type: "string" }, qtyMt: { type: "number" } },
          required: ["grade"],
        },
      },
    },
    required: ["chemicals"],
  };

  let result: ChemicalReportExtraction;
  try {
    result = await extractViaTool<ChemicalReportExtraction>({
      imageBase64,
      mediaType,
      systemPrompt:
        "You are transcribing a hand-maintained paper mill chemical stock/usage report photo into exact structured data. Never invent numbers — omit a field if the photo doesn't clearly show it.",
      toolName: "record_chemical_report",
      toolDescription: "Records the chemical stock/usage table and today's grade production from the photo.",
      inputSchema,
    });
  } catch (err) {
    return { slice: {}, warnings: [{ message: `Vision extraction failed: ${(err as Error).message}` }] };
  }

  const slice: ParsedDailyReportSlice = {};
  if (result.date) {
    const parsed = parseMillDate(result.date);
    if (parsed) slice.date = parsed;
  }

  slice.chemicalUsage = result.chemicals.map(
    (c): ParsedChemicalUsage => ({
      shift: null,
      chemicalName: c.name,
      rateRsPerKg: c.rateRsPerKg,
      openStockKg: c.openStockKg,
      receivedQtyKg: c.receivedQtyKg,
      usedQtyKg: c.usedQtyKg,
      meterUsedQtyKg: c.asPerFlowMeterUsedQtyKg,
      recipeQtyKg: c.qtyAsPerRecipeKg,
      usePerTonKg: c.usePerTonPaperKg,
      closingStockKg: c.closingStockKg,
      reorderLevelKg: c.reorderStockLevelKg,
    })
  );

  if (result.gradeProductionToday?.length) {
    slice.gradeProduction = result.gradeProductionToday.map(
      (g): ParsedGradeProduction => ({ shift: null, grade: g.grade, qtyMt: g.qtyMt })
    );
  }

  if (result.chemicals.length === 0) warnings.push({ message: "No chemical rows extracted." });

  return { slice, warnings };
}

// --- Shift-wise Chemical Report ---

interface ShiftChemicalReportExtraction {
  date?: string;
  shifts: Array<{
    shift: "A" | "B" | "C";
    chemicals: Array<{
      name: string;
      actualUsedKg?: number;
      asPerFlowUsedKg?: number;
      usedQtyPerTonPaperKg?: number;
      costPerTonPaperRs?: number;
    }>;
    gradeProduction?: Array<{ grade: string; qtyMt?: number; gsm?: string }>;
  }>;
}

export async function parseShiftChemicalReportImage(
  imageBase64: string,
  mediaType: ImageMediaType
): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const inputSchema: Anthropic.Tool.InputSchema = {
    type: "object",
    properties: {
      date: { type: "string" },
      shifts: {
        type: "array",
        description: "The three shift columns: A-SHIFT REPORT, B-SHIFT REPORT, C-SHIFT REPORT.",
        items: {
          type: "object",
          properties: {
            shift: { type: "string", enum: ["A", "B", "C"] },
            chemicals: {
              type: "array",
              description:
                "One row per PARTICULARS (PAC, FINOR DIFOAMER, N.T.P.D, IVAX RTN 102, IVAX AF105, hypo, G M F, CWT-3014, HCL, Finor OX-425, NATIVE STARCH, Arya chemical, AQUA BOOSTER 202, etc).",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  actualUsedKg: { type: "number", description: "Actual Used Qty-(Kg) column" },
                  asPerFlowUsedKg: { type: "number", description: "As per flow Used Qty-(Kg) column" },
                  usedQtyPerTonPaperKg: { type: "number", description: "Used Qty/Ton of paper column" },
                  costPerTonPaperRs: { type: "number", description: "Cost/Ton of paper column" },
                },
                required: ["name"],
              },
            },
            gradeProduction: {
              type: "array",
              description: `This shift's Grade/QTY/GSM table (grades like ${GRADE_NAMES.join(", ")}).`,
              items: {
                type: "object",
                properties: {
                  grade: { type: "string" },
                  qtyMt: { type: "number" },
                  gsm: { type: "string" },
                },
                required: ["grade"],
              },
            },
          },
          required: ["shift", "chemicals"],
        },
      },
    },
    required: ["shifts"],
  };

  let result: ShiftChemicalReportExtraction;
  try {
    result = await extractViaTool<ShiftChemicalReportExtraction>({
      imageBase64,
      mediaType,
      systemPrompt:
        "You are transcribing a hand-maintained paper mill shift-wise chemical usage report photo (three shift columns: A, B, C) into exact structured data. Never invent numbers — omit a field if the photo doesn't clearly show it.",
      toolName: "record_shift_chemical_report",
      toolDescription: "Records per-shift chemical usage and grade production from the photo.",
      inputSchema,
    });
  } catch (err) {
    return { slice: {}, warnings: [{ message: `Vision extraction failed: ${(err as Error).message}` }] };
  }

  const slice: ParsedDailyReportSlice = { chemicalUsage: [], gradeProduction: [] };
  if (result.date) {
    const parsed = parseMillDate(result.date);
    if (parsed) slice.date = parsed;
  }

  for (const s of result.shifts) {
    for (const c of s.chemicals) {
      slice.chemicalUsage!.push({
        shift: s.shift as Shift,
        chemicalName: c.name,
        usedQtyKg: c.actualUsedKg,
        meterUsedQtyKg: c.asPerFlowUsedKg,
        usePerTonKg: c.usedQtyPerTonPaperKg,
        costPerTonRs: c.costPerTonPaperRs,
      });
    }
    for (const g of s.gradeProduction ?? []) {
      slice.gradeProduction!.push({
        shift: s.shift as Shift,
        grade: g.grade,
        qtyMt: g.qtyMt,
        gsm: g.gsm,
      });
    }
  }

  if (result.shifts.length < 3) {
    warnings.push({ message: `Only found ${result.shifts.length}/3 shifts in the shift-wise chemical report.` });
  }
  if (slice.chemicalUsage!.length === 0) delete slice.chemicalUsage;
  if (slice.gradeProduction!.length === 0) delete slice.gradeProduction;

  return { slice, warnings };
}

// --- Wastage Report ---

interface WastageReportExtraction {
  date?: string;
  trimWasteKg?: number[];
  brokeWasteKg?: number[];
  corePaperWasteNightShiftKg?: number;
}

export async function parseWastageReportImage(
  imageBase64: string,
  mediaType: ImageMediaType
): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const inputSchema: Anthropic.Tool.InputSchema = {
    type: "object",
    properties: {
      date: { type: "string" },
      trimWasteKg: {
        type: "array",
        description: "Every non-empty value in the TRIM WASTE column, one per SR NO. row, top to bottom.",
        items: { type: "number" },
      },
      brokeWasteKg: {
        type: "array",
        description: "Every non-empty value in the BROKE WASTE column, one per SR NO. row, top to bottom.",
        items: { type: "number" },
      },
      corePaperWasteNightShiftKg: {
        type: "number",
        description: "The single CORE/PAPER WASTE (Night shift) figure.",
      },
    },
  };

  let result: WastageReportExtraction;
  try {
    result = await extractViaTool<WastageReportExtraction>({
      imageBase64,
      mediaType,
      systemPrompt:
        "You are transcribing a hand-maintained paper mill wastage report photo into exact structured data. Never invent numbers — omit a field if the photo doesn't clearly show it.",
      toolName: "record_wastage_report",
      toolDescription: "Records the trim/broke/core waste line items from the photo.",
      inputSchema,
    });
  } catch (err) {
    return { slice: {}, warnings: [{ message: `Vision extraction failed: ${(err as Error).message}` }] };
  }

  const slice: ParsedDailyReportSlice = { wastage: [] };
  if (result.date) {
    const parsed = parseMillDate(result.date);
    if (parsed) slice.date = parsed;
  }

  (result.trimWasteKg ?? []).forEach((weightKg, i) => {
    slice.wastage!.push({ category: "trim_waste", srNo: i + 1, weightKg });
  });
  (result.brokeWasteKg ?? []).forEach((weightKg, i) => {
    slice.wastage!.push({ category: "broke_waste", srNo: i + 1, weightKg });
  });
  if (result.corePaperWasteNightShiftKg != null) {
    slice.wastage!.push({ category: "core_paper_waste", weightKg: result.corePaperWasteNightShiftKg });
  }

  if (slice.wastage!.length === 0) {
    warnings.push({ message: "No wastage figures extracted." });
    delete slice.wastage;
  }

  return { slice, warnings };
}

// --- Generic figures (attachments with no fixed layout yet, e.g. dispatch) ---

interface GenericFiguresExtraction {
  date?: string;
  figures: Array<{ label: string; value?: number; unit?: string }>;
}

/**
 * Unlike the three schemas above, this has no known column layout to describe —
 * it just asks for whatever "label: number" readings are visible on the photo.
 * Meant as a starting point until a real sample lets us write a proper schema.
 */
export async function parseGenericFiguresImage(
  imageBase64: string,
  mediaType: ImageMediaType,
  sourceLabel: string
): Promise<ParseResult> {
  const warnings: ParseResult["warnings"] = [];
  const inputSchema: Anthropic.Tool.InputSchema = {
    type: "object",
    properties: {
      date: { type: "string", description: "Report date exactly as printed, if visible" },
      figures: {
        type: "array",
        description: "Every distinct labeled number visible on the photo (totals, per-item quantities, etc).",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The printed label/row name for this figure" },
            value: { type: "number" },
            unit: { type: "string", description: "e.g. MT, Kg, units — only if printed" },
          },
          required: ["label"],
        },
      },
    },
    required: ["figures"],
  };

  let result: GenericFiguresExtraction;
  try {
    result = await extractViaTool<GenericFiguresExtraction>({
      imageBase64,
      mediaType,
      systemPrompt: `You are transcribing a ${sourceLabel} report photo into exact structured data. This sheet's exact layout isn't known in advance — record every labeled number you can clearly read. Never invent numbers — omit a figure if the photo doesn't clearly show it.`,
      toolName: "record_figures",
      toolDescription: `Records the labeled figures visible on the ${sourceLabel} photo.`,
      inputSchema,
    });
  } catch (err) {
    return { slice: {}, warnings: [{ message: `Vision extraction failed: ${(err as Error).message}` }] };
  }

  const slice: ParsedDailyReportSlice = {};
  if (result.date) {
    const parsed = parseMillDate(result.date);
    if (parsed) slice.date = parsed;
  }

  slice.miscFigures = result.figures.map(
    (f): ParsedMiscFigure => ({ sourceLabel, label: f.label, value: f.value, unit: f.unit })
  );
  if (slice.miscFigures.length === 0) {
    warnings.push({ message: `No figures extracted from the ${sourceLabel} photo.` });
    delete slice.miscFigures;
  }

  return { slice, warnings };
}

export type { ParsedWastageItem };
