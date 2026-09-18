import { NextRequest, NextResponse } from "next/server";
import { commitReport } from "@/lib/data/commit";
import { db } from "@/db";
import { dailyReports } from "@/db/schema";
import { desc } from "drizzle-orm";
import type { ParsedDailyReportSlice } from "@/lib/data/types";

export const runtime = "nodejs";

/** Commits a reviewed draft slice for a date into the typed tables. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { date?: string; slice?: ParsedDailyReportSlice };
  if (!body.date || !body.slice) {
    return NextResponse.json({ error: "date and slice are required." }, { status: 400 });
  }
  await commitReport(body.date, body.slice);
  return NextResponse.json({ ok: true });
}

/** Lists recent daily reports (summary) for the dashboard. */
export async function GET() {
  const rows = await db.select().from(dailyReports).orderBy(desc(dailyReports.date)).limit(60).all();
  return NextResponse.json({ reports: rows });
}
