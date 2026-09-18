"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SourceSlot {
  key: string;
  sourceType: string;
  label: string;
  accept: string;
  hint: string;
}

const SLOTS: SourceSlot[] = [
  {
    key: "mis",
    sourceType: "mis_xlsx",
    label: "Daily MIS / Flash Report",
    accept: ".xlsx,.xls",
    hint: "the shift production/power/downtime workbook",
  },
  {
    key: "whatsapp",
    sourceType: "whatsapp_docx",
    label: "WhatsApp Updates",
    accept: ".docx",
    hint: "the shift-wise WhatsApp text, saved as Word",
  },
  {
    key: "chemical",
    sourceType: "chemical_image",
    label: "Chemical Report (photo)",
    accept: "image/*",
    hint: "whole-day chemical stock/usage sheet",
  },
  {
    key: "shiftChemical",
    sourceType: "shift_chemical_image",
    label: "Shift-wise Chemical Report (photo)",
    accept: "image/*",
    hint: "A/B/C chemical usage sheet",
  },
  {
    key: "wastage",
    sourceType: "wastage_image",
    label: "Wastage Report (photo)",
    accept: "image/*",
    hint: "trim/broke/core waste sheet",
  },
];

interface Conflict {
  path: string;
  values: { source: string; value: unknown }[];
}
interface SourceWarning {
  sourceType: string;
  filename: string;
  warnings: { message: string }[];
}

export default function UploadPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<SourceWarning[]>([]);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);

  const handleParse = async () => {
    setError(null);
    setCommitted(false);
    const selected = Object.entries(files).filter(([, f]) => f);
    if (selected.length === 0) {
      setError("Pick at least one file.");
      return;
    }
    const form = new FormData();
    for (const [key, file] of selected) {
      const slot = SLOTS.find((s) => s.key === key)!;
      form.append("files", file!);
      form.append("sourceTypes", slot.sourceType);
    }

    setParsing(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed.");
      const data = await res.json();
      if (data.merged.date && data.merged.date !== date) {
        setDate(data.merged.date);
      }
      setConflicts(data.conflicts ?? []);
      setSourceWarnings(data.sources ?? []);
      setDraftText(JSON.stringify(data.merged, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    if (!draftText) return;
    setError(null);
    let slice: unknown;
    try {
      slice = JSON.parse(draftText);
    } catch {
      setError("The draft below isn't valid JSON — fix it before committing.");
      return;
    }
    setCommitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, slice }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Commit failed.");
      setCommitted(true);
      setTimeout(() => router.push("/"), 700);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 className="text-lg">Upload today&apos;s reports</h1>

      <div className="flex items-center gap-3">
        <label className="text-xs uppercase tracking-widest text-[var(--text-muted)]">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] px-2 py-1 text-sm"
        />
        <span className="text-xs text-[var(--text-muted)]">
          (auto-corrected from the files once parsed, if they disagree)
        </span>
      </div>

      <div className="grid gap-3">
        {SLOTS.map((slot) => (
          <label
            key={slot.key}
            className="border border-[var(--border)] bg-[var(--surface)] rounded-sm px-3 py-2 flex items-center justify-between gap-3 cursor-pointer hover:border-[var(--series-1)]"
          >
            <div>
              <div className="text-sm">{slot.label}</div>
              <div className="text-xs text-[var(--text-muted)]">{slot.hint}</div>
            </div>
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="text-[var(--text-secondary)] max-w-40 truncate">
                {files[slot.key]?.name ?? "no file"}
              </span>
              <input
                type="file"
                accept={slot.accept}
                className="hidden"
                onChange={(e) => setFiles((f) => ({ ...f, [slot.key]: e.target.files?.[0] ?? null }))}
              />
              <span className="border border-[var(--border)] px-2 py-1">choose</span>
            </div>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-[var(--status-critical)]">{error}</p>}

      <button
        onClick={handleParse}
        disabled={parsing}
        className="self-start border border-[var(--series-1)] text-[var(--series-1)] px-4 py-2 text-sm hover:bg-[var(--series-1)] hover:text-black transition-colors disabled:opacity-50"
      >
        {parsing ? "parsing…" : "parse files"}
      </button>

      {sourceWarnings.some((s) => s.warnings.length > 0) && (
        <div className="border border-[var(--status-warning)] rounded-sm p-3 flex flex-col gap-1">
          <h2 className="text-xs uppercase tracking-widest text-[var(--status-warning)]">Parser warnings</h2>
          {sourceWarnings
            .filter((s) => s.warnings.length > 0)
            .map((s) => (
              <div key={s.sourceType} className="text-xs text-[var(--text-secondary)]">
                <span className="text-[var(--text-primary)]">{s.filename}</span>
                <ul className="list-disc list-inside ml-2">
                  {s.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="border border-[var(--status-critical)] rounded-sm p-3 flex flex-col gap-1">
          <h2 className="text-xs uppercase tracking-widest text-[var(--status-critical)]">
            Conflicts between sources — check before committing
          </h2>
          {conflicts.map((c, i) => (
            <div key={i} className="text-xs text-[var(--text-secondary)]">
              <span className="text-[var(--text-primary)]">{c.path}</span>:{" "}
              {c.values.map((v) => `${v.source}=${JSON.stringify(v.value)}`).join(" vs ")}
            </div>
          ))}
        </div>
      )}

      {draftText != null && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
            Review draft — edit anything before committing
          </h2>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            spellCheck={false}
            className="w-full h-96 bg-[var(--surface)] border border-[var(--border)] rounded-sm p-3 text-xs font-mono text-[var(--text-secondary)] focus:text-[var(--text-primary)] focus:border-[var(--series-1)] outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleCommit}
              disabled={committing}
              className="self-start border border-[var(--status-good)] text-[var(--status-good)] px-4 py-2 text-sm hover:bg-[var(--status-good)] hover:text-black transition-colors disabled:opacity-50"
            >
              {committing ? "saving…" : "commit to dashboard"}
            </button>
            {committed && <span className="text-xs text-[var(--status-good)]">saved — redirecting…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
