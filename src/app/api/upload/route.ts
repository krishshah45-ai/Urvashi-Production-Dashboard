import { NextRequest, NextResponse } from "next/server";
import { parseMisReport } from "@/lib/parsers/misReport";
import { parseWhatsappText } from "@/lib/parsers/whatsappUpdate";
import {
  parseChemicalReportImage,
  parseShiftChemicalReportImage,
  parseWastageReportImage,
  parseGenericFiguresImage,
  type ImageMediaType,
} from "@/lib/parsers/imageExtraction";
import { parseGenericSpreadsheet, parseGenericText } from "@/lib/parsers/genericAttachment";
import { mergeSlices } from "@/lib/data/merge";
import type { ParseResult } from "@/lib/data/types";

export const runtime = "nodejs";

const SOURCE_TYPES = [
  "mis_xlsx",
  "whatsapp_text",
  "chemical_image",
  "shift_chemical_image",
  "wastage_image",
  "dispatch_attachment",
] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const SPREADSHEET_EXT = /\.(xlsx|xls)$/i;

/** Routes a "no known layout yet" attachment (currently just dispatch) by its content type. */
async function parseDispatchAttachment(file: File, buffer: Buffer): Promise<ParseResult> {
  const sourceLabel = "dispatch";
  if (file.type.startsWith("image/")) {
    const mediaType = (file.type || "image/jpeg") as ImageMediaType;
    return parseGenericFiguresImage(buffer.toString("base64"), mediaType, sourceLabel);
  }
  if (file.type.includes("spreadsheet") || file.type === "application/vnd.ms-excel" || SPREADSHEET_EXT.test(file.name)) {
    return parseGenericSpreadsheet(buffer, sourceLabel);
  }
  if (file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
    return parseGenericText(buffer.toString("utf-8"), sourceLabel);
  }
  return {
    slice: {},
    warnings: [
      {
        message: `Don't know how to read "${file.name}" (${file.type || "unknown type"}) yet — add dispatch figures manually in the review draft.`,
      },
    ],
  };
}

/**
 * Accepts one or more files for a given day, each tagged with which report it
 * is (`sourceType`), runs the matching parser, and returns the merged draft
 * plus any conflicts/warnings for the review screen. Nothing is written to
 * the database here — see /api/reports for the commit step.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const entries = form.getAll("files") as File[];
  const sourceTypes = form.getAll("sourceTypes") as string[];

  if (entries.length === 0) {
    return NextResponse.json({ error: "No files provided." }, { status: 400 });
  }
  if (entries.length !== sourceTypes.length) {
    return NextResponse.json({ error: "files/sourceTypes length mismatch." }, { status: 400 });
  }

  const results: { name: string; sourceType: SourceType; filename: string; result: ParseResult }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const file = entries[i];
    const sourceType = sourceTypes[i] as SourceType;
    if (!SOURCE_TYPES.includes(sourceType)) {
      return NextResponse.json({ error: `Unknown sourceType "${sourceType}".` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    let result: ParseResult;
    try {
      switch (sourceType) {
        case "mis_xlsx":
          result = await parseMisReport(buffer);
          break;
        case "whatsapp_text":
          result = parseWhatsappText(buffer.toString("utf-8"));
          break;
        case "chemical_image":
        case "shift_chemical_image":
        case "wastage_image": {
          const mediaType = (file.type || "image/jpeg") as ImageMediaType;
          const base64 = buffer.toString("base64");
          if (sourceType === "chemical_image") result = await parseChemicalReportImage(base64, mediaType);
          else if (sourceType === "shift_chemical_image")
            result = await parseShiftChemicalReportImage(base64, mediaType);
          else result = await parseWastageReportImage(base64, mediaType);
          break;
        }
        case "dispatch_attachment":
          result = await parseDispatchAttachment(file, buffer);
          break;
      }
    } catch (err) {
      result = { slice: {}, warnings: [{ message: `Parser error: ${(err as Error).message}` }] };
    }

    results.push({ name: sourceType, sourceType, filename: file.name, result });
  }

  const { merged, conflicts } = mergeSlices(results.map((r) => ({ name: r.name, slice: r.result.slice })));

  return NextResponse.json({
    merged,
    conflicts,
    sources: results.map((r) => ({
      sourceType: r.sourceType,
      filename: r.filename,
      warnings: r.result.warnings,
    })),
  });
}
