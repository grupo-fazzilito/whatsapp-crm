'use client';

// Plain SVG/CSS charts for reports. Colors are role tokens (see
// VizStyles): categorical slots validated for both the dark (default)
// and light dashboard modes; text always uses text tokens, never the
// series color. Every chart ships next to a data table + CSV export.

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { niceTicks } from '@/lib/reports/format';

/** Series tokens. Dark is the dashboard default; html[data-mtheme=light] swaps them. */
export function VizStyles() {
  return (
    <style>{`
.rpt-viz{--rpt-s1:#3987e5;--rpt-s2:#d95926;--rpt-s3:#199e70;--rpt-s4:#9085e9;--rpt-none:#5f5e5a;--rpt-ring:var(--card);
--rpt-q1:#0d366b;--rpt-q2:#184f95;--rpt-q3:#256abf;--rpt-q4:#3987e5;--rpt-q5:#6da7ec;--rpt-q6:#9ec5f4}
html[data-mtheme="light"] .rpt-viz{--rpt-s1:#2a78d6;--rpt-s2:#eb6834;--rpt-s3:#1baf7a;--rpt-s4:#4a3aa7;--rpt-none:#b5b4ad;
--rpt-q1:#cde2fb;--rpt-q2:#9ec5f4;--rpt-q3:#6da7ec;--rpt-q4:#3987e5;--rpt-q5:#256abf;--rpt-q6:#184f95}
@media (forced-colors: active){.rpt-viz .rpt-swatch{forced-color-adjust:none}}
`}</style>
  );
}

export interface Series {
  key: string;
  label: string;
  /** CSS color (use the --rpt-s* tokens). */
  color: string;
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span aria-hidden className="rpt-swatch inline-block size-2.5 rounded-sm" style={{ background: it.color }} />
          <span>{it.label}</span>
          {it.value !== undefined && <span className="font-medium text-foreground tabular-nums">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

const VB_W = 720;
const VB_H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 40 };

/**
 * Multi-series line chart over day keys. Crosshair + tooltip on hover;
 * focusable, ←/→ move the crosshair for keyboard users.
 */
export function LineChart({
  labels,
  series,
  data,
  ariaLabel,
  formatLabel,
  formatValue,
}: {
  labels: string[];
  series: Series[];
  data: Record<string, number>[];
  ariaLabel: string;
  formatLabel: (l: string) => string;
  formatValue: (v: number) => string;
}) {
  const [idx, setIdx] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const tipId = useId();
  const max = useMemo(() => Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0))), [data, series]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const w = VB_W - PAD.left - PAD.right;
  const h = VB_H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length <= 1 ? w / 2 : (i * w) / (labels.length - 1));
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const every = Math.max(1, Math.ceil(labels.length / 8));

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = ref.current;
    if (!svg || labels.length === 0) return;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * VB_W;
    const i = labels.length <= 1 ? 0 : Math.round(((vx - PAD.left) / w) * (labels.length - 1));
    setIdx(Math.max(0, Math.min(labels.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setIdx((cur) => {
      const base = cur ?? (e.key === 'ArrowLeft' ? labels.length : -1);
      return Math.max(0, Math.min(labels.length - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };

  const tipLeftPct = idx !== null ? (x(idx) / VB_W) * 100 : 0;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        aria-label={ariaLabel}
        aria-describedby={idx !== null ? tipId : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={VB_W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          (i % every === 0 && labels.length - 1 - i >= Math.ceil(every / 2)) || i === labels.length - 1 ? (
            <text key={l} x={x(i)} y={VB_H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {formatLabel(l)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(d[s.key] ?? 0)}`).join(' ');
          return (
            <g key={s.key}>
              {labels.length > 1 && <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {labels.length <= 1 &&
                data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d[s.key] ?? 0)} r={4} fill={s.color} stroke="var(--rpt-ring)" strokeWidth={2} />)}
            </g>
          );
        })}
        {idx !== null && (
          <g aria-hidden>
            <line x1={x(idx)} x2={x(idx)} y1={PAD.top} y2={PAD.top + h} stroke="var(--muted-foreground)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.key} cx={x(idx)} cy={y(data[idx]?.[s.key] ?? 0)} r={4.5} fill={s.color} stroke="var(--rpt-ring)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={PAD.left - 10}
          y={PAD.top}
          width={w + 20}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setIdx(null)}
        />
      </svg>
      {idx !== null && data[idx] && (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-1 z-10 w-max min-w-40 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: `clamp(80px, ${tipLeftPct}%, calc(100% - 80px))` }}
        >
          <p className="mb-1 font-medium">{formatLabel(labels[idx])}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="rpt-swatch inline-block size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-medium tabular-nums">{formatValue(data[idx][s.key] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with the value at the tip (single series). */
export function BarList({
  rows,
  color = 'var(--rpt-s1)',
  formatValue,
  ariaLabel,
}: {
  rows: { label: string; value: number; hint?: string }[];
  color?: string;
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 text-sm" title={r.hint}>
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="rpt-swatch block h-3.5 rounded-r-[4px]"
              style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 85)}%`, background: color }}
            />
            <span className="shrink-0 font-medium text-foreground tabular-nums">{formatValue(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 100% stacked bar (2px surface gaps) with a legend carrying the values. */
export function StackBar({
  parts,
  ariaLabel,
  formatValue,
}: {
  parts: { label: string; value: number; color: string }[];
  ariaLabel: string;
  formatValue: (v: number) => string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px] bg-muted" role="img" aria-label={ariaLabel}>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span
                key={p.label}
                className="rpt-swatch block h-full"
                style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
                title={`${p.label}: ${formatValue(p.value)}`}
              />
            ))}
      </div>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: formatValue(p.value) }))} />
    </div>
  );
}

/** Day-of-week × hour heatmap (sequential blue, 6 quantized steps). */
export function Heatmap({
  matrix,
  dayLabels,
  ariaLabel,
  cellTitle,
  lessLabel,
  moreLabel,
}: {
  matrix: number[][];
  dayLabels: string[];
  ariaLabel: string;
  cellTitle: (day: number, hour: number, v: number) => string;
  lessLabel: string;
  moreLabel: string;
}) {
  const max = Math.max(0, ...matrix.flat());
  const step = (v: number) => (v <= 0 || max === 0 ? 0 : Math.min(6, Math.max(1, Math.ceil((v / max) * 6))));
  const fill = (s: number) => (s === 0 ? 'var(--muted)' : `var(--rpt-q${s})`);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img" aria-label={ariaLabel}>
          <span />
          {Array.from({ length: 24 }, (_, hr) => (
            <span key={hr} className="text-center text-[10px] text-muted-foreground tabular-nums">
              {hr % 3 === 0 ? hr : ''}
            </span>
          ))}
          {matrix.map((row, d) => (
            <HeatRow key={d} label={dayLabels[d]}>
              {row.map((v, hr) => (
                <span
                  key={hr}
                  className="rpt-swatch block aspect-square min-h-3 rounded-[3px]"
                  style={{ background: fill(step(v)) }}
                  title={cellTitle(d, hr, v)}
                />
              ))}
            </HeatRow>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden>
        <span>{lessLabel}</span>
        {[0, 1, 2, 3, 4, 5, 6].map((s) => (
          <span key={s} className="rpt-swatch inline-block size-3 rounded-[3px]" style={{ background: fill(s) }} />
        ))}
        <span>{moreLabel}</span>
      </div>
    </div>
  );
}

function HeatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="self-center pr-1 text-[11px] text-muted-foreground">{label}</span>
      {children}
    </>
  );
}

/** KPI tile: label, value, optional secondary line. */
export function StatTile({ label, value, sub, className }: { label: string; value: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-xl border border-border bg-card p-4', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}
