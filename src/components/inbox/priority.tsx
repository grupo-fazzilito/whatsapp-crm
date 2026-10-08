"use client";

import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Minus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { PRIORITY_ORDER, priorityOf } from "@/lib/inbox/priority";
import type { Priority } from "@/lib/inbox/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Icon + colour per priority (never colour alone: every use also carries
// the icon and a text label or sr-only text).
export const PRIORITY_STYLE: Record<Priority, { Icon: typeof AlertTriangle; className: string }> = {
  urgent: { Icon: AlertTriangle, className: "text-red-400" },
  high: { Icon: ArrowUp, className: "text-orange-400" },
  normal: { Icon: Minus, className: "text-slate-400" },
  low: { Icon: ArrowDown, className: "text-sky-400" },
};

/** Compact indicator for the conversation list (hidden for 'normal'). */
export function PriorityIndicator({ priority, showNormal = false }: { priority: unknown; showNormal?: boolean }) {
  const { t } = useI18n();
  const p = priorityOf(priority);
  if (p === "normal" && !showNormal) return null;
  const { Icon, className } = PRIORITY_STYLE[p];
  const label = t(`inboxpro.priority.${p}`);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium", className)}
      title={t("inboxpro.priority.current", { name: label })}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className={p === "urgent" ? "" : "sr-only"}>{label}</span>
    </span>
  );
}

interface PriorityPickerProps {
  value: unknown;
  onChange: (p: Priority) => void;
  disabled?: boolean;
}

/** Thread-header selector. */
export function PriorityPicker({ value, onChange, disabled }: PriorityPickerProps) {
  const { t } = useI18n();
  const current = priorityOf(value);
  const { Icon, className } = PRIORITY_STYLE[current];
  const label = t(`inboxpro.priority.${current}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`${t("inboxpro.priority.change")}: ${label}`}
        title={t("inboxpro.priority.current", { name: label })}
        className={cn(
          "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-slate-800 disabled:opacity-60",
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden xl:inline">{label}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-slate-700 bg-slate-800">
        {PRIORITY_ORDER.map((p) => {
          const s = PRIORITY_STYLE[p];
          return (
            <DropdownMenuItem
              key={p}
              onClick={() => p !== current && onChange(p)}
              className={cn("gap-2 text-sm", p === current ? "text-white" : "text-slate-300")}
            >
              <s.Icon className={cn("h-3.5 w-3.5", s.className)} aria-hidden="true" />
              <span className="flex-1">{t(`inboxpro.priority.${p}`)}</span>
              {p === current && <Check className="h-3 w-3" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
