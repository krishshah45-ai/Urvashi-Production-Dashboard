import Link from "next/link";
import { db } from "@/db";
import { chemicalUsage } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  listRecentReports,
  listShiftMetricsInRange,
  summarizeByDay,
  computeRedFlags,
  getReportByDate,
} from "@/lib/data/queries";
import { StatTile } from "@/components/StatTile";
import { RedFlags } from "@/components/RedFlags";
import { ProductionTrendChart } from "@/components/ProductionTrendChart";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const reports = await listRecentReports(90);
  const latest = reports[0];

  if (!latest) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center flex flex-col gap-4">
        <p className="text-[var(--text-secondary)] text-sm">No reports uploaded yet.</p>
        <Link
          href="/upload"
          className="inline-block self-center border border-[var(--series-1)] text-[var(--series-1)] px-4 py-2 text-sm hover:bg-[var(--series-1)] hover:text-black transition-colors"
        >
          upload today&apos;s reports →
        </Link>
      </div>
    );
  }

  const monthStart = `${latest.date.slice(0, 7)}-01`;
  const [monthRows, latestFull] = await Promise.all([
    listShiftMetricsInRange(monthStart, latest.date),
    getReportByDate(latest.date),
  ]);

  const dayTotals = summarizeByDay(monthRows);
  const latestDay = dayTotals.find((d) => d.date === latest.date);
  const mtdProduction = dayTotals.reduce((sum, d) => sum + d.productionMt, 0);
  const mtdUnits = dayTotals.reduce((sum, d) => sum + d.totalUnits, 0);
  const mtdUpt = mtdProduction > 0 ? mtdUnits / mtdProduction : null;

  const redFlags = latestFull ? computeRedFlags(latestFull.shifts) : [];

  const dailyChemicals = await db
    .select()
    .from(chemicalUsage)
    .where(eq(chemicalUsage.reportDate, latest.date))
    .all();
  const wholeDayChemicals = dailyChemicals.filter((c) => c.shift == null);
  const chemicalCostVsRecipe = wholeDayChemicals.reduce(
    (acc, c) => {
      if (c.costPerTonRs != null) acc.actual += c.costPerTonRs;
      return acc;
    },
    { actual: 0 }
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-[var(--text-primary)]">Daily snapshot</h1>
          <p className="text-xs text-[var(--text-muted)]">
            latest: {latest.date} · status: {latest.status}
          </p>
        </div>
        <Link
          href="/upload"
          className="border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--series-1)] hover:text-[var(--series-1)]"
        >
          + upload
        </Link>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Production" value={(latestDay?.productionMt ?? 0).toFixed(2)} unit="MT" sub="today" />
        <StatTile
          label="Power"
          value={latestDay?.unitsPerTon ? latestDay.unitsPerTon.toFixed(1) : "—"}
          unit="units/MT"
          sub="today"
        />
        <StatTile label="Downtime" value={String(latestDay?.downtimeTotalMin ?? 0)} unit="min" sub="today, all shifts" />
        <StatTile label="Water" value={(latestDay?.waterKl ?? 0).toFixed(0)} unit="KL" sub="today, all shifts" />
        <StatTile label="MTD Production" value={mtdProduction.toFixed(1)} unit="MT" sub={latest.date.slice(0, 7)} />
        <StatTile label="MTD Power" value={mtdUpt ? mtdUpt.toFixed(1) : "—"} unit="units/MT" sub="month avg" />
        <StatTile
          label="Chemical cost"
          value={chemicalCostVsRecipe.actual > 0 ? chemicalCostVsRecipe.actual.toFixed(0) : "—"}
          unit="Rs/MT"
          sub="today, actual"
        />
        <StatTile
          label="Waste-paper intake"
          value={String(
            (latestFull?.rawMaterial ?? []).reduce((s, r) => s + (r.dailyQtyMt ?? 0), 0).toFixed(1)
          )}
          unit="MT"
          sub="today"
        />
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface)] rounded-sm p-4">
        <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-3">Red flags</h2>
        <RedFlags flags={redFlags} />
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface)] rounded-sm p-4">
        <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Production — {latest.date.slice(0, 7)}
        </h2>
        <ProductionTrendChart data={dayTotals} />
      </section>

      {latestFull && (
        <section className="border border-[var(--border)] bg-[var(--surface)] rounded-sm p-4 overflow-x-auto">
          <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-3">
            Shift breakdown — {latest.date}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] text-xs uppercase tracking-wide">
                <th className="py-1 pr-4">Shift</th>
                <th className="py-1 pr-4">Prod (MT)</th>
                <th className="py-1 pr-4">Units/MT</th>
                <th className="py-1 pr-4">Downtime (min)</th>
                <th className="py-1 pr-4">Water (KL)</th>
                <th className="py-1 pr-4">Reason</th>
              </tr>
            </thead>
            <tbody>
              {latestFull.shifts.map((s) => (
                <tr key={s.shift} className="border-t border-[var(--gridline)]">
                  <td className="py-1.5 pr-4 text-[var(--text-primary)]">{s.shift}</td>
                  <td className="py-1.5 pr-4">{s.productionMt?.toFixed(2) ?? "—"}</td>
                  <td className="py-1.5 pr-4">{s.totalUpt?.toFixed(1) ?? "—"}</td>
                  <td className="py-1.5 pr-4">{s.downtimeTotalMin ?? "—"}</td>
                  <td className="py-1.5 pr-4">
                    {((s.waterGidcKl ?? 0) + (s.waterBoilerKl ?? 0)).toFixed(0)}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--text-secondary)]">{s.downtimeReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {latestFull && latestFull.notes && (
        <section className="border border-[var(--border)] bg-[var(--surface)] rounded-sm p-4">
          <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-3">Engineer notes</h2>
          <pre className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{latestFull.notes}</pre>
        </section>
      )}

      <section className="text-xs text-[var(--text-muted)]">
        {reports.length} day{reports.length === 1 ? "" : "s"} on record.{" "}
        <Link href="/upload" className="text-[var(--series-1)]">
          Upload another day →
        </Link>
      </section>
    </div>
  );
}
