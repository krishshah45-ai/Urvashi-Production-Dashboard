import type { RedFlag } from "@/lib/data/queries";

const STYLES: Record<RedFlag["severity"], { color: string; label: string }> = {
  critical: { color: "var(--status-critical)", label: "CRIT" },
  warn: { color: "var(--status-warning)", label: "WARN" },
};

export function RedFlags({ flags }: { flags: RedFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--status-good)]">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--status-good)]" />
        No red flags for the latest day.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span
            className="mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
            style={{ color: STYLES[f.severity].color, border: `1px solid ${STYLES[f.severity].color}` }}
          >
            {STYLES[f.severity].label}
          </span>
          <span className="text-[var(--text-secondary)]">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}
