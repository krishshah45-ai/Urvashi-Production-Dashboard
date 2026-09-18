export function StatTile({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-sm px-4 py-3 flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl text-[var(--text-primary)]">{value}</span>
        {unit && <span className="text-xs text-[var(--text-secondary)]">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-[var(--text-secondary)]">{sub}</div>}
    </div>
  );
}
