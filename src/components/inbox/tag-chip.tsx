"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagChipProps {
  name: string;
  color?: string | null;
  size?: "xs" | "sm";
  /** Renders an "x" button with this accessible label. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/**
 * Tag pill: the tag colour is only a tinted background + dot; the name is
 * always light text on the dark inbox, so contrast never depends on the
 * user-picked colour.
 */
export function TagChip({ name, color, size = "sm", onRemove, removeLabel, className }: TagChipProps) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#64748b";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border text-slate-100",
        size === "xs" ? "h-4 px-1.5 text-[10px]" : "h-6 px-2 text-xs",
        className,
      )}
      style={{ backgroundColor: `${c}33`, borderColor: `${c}66` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} aria-hidden="true" />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-black/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
