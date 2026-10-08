"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import type { Tag } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagChip } from "./tag-chip";

const NEW_TAG_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#f97316"];

export interface ConversationTagLink {
  id: string;
  tag_id: string;
}

interface ConversationTagsProps {
  conversationId: string;
  links: ConversationTagLink[];
  tags: Tag[];
  tagsById: Map<string, Tag>;
  /** Admins may create new tags inline. */
  canCreate: boolean;
  onLinksChange: (conversationId: string, links: ConversationTagLink[]) => void;
  onTagCreated: (tag: Tag) => void;
}

/** Tag chips of a conversation + the add/remove popover (thread header). */
export function ConversationTags({
  conversationId,
  links,
  tags,
  tagsById,
  canCreate,
  onLinksChange,
  onTagCreated,
}: ConversationTagsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const applied = useMemo(() => new Set(links.map((l) => l.tag_id)), [links]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? tags.filter((tg) => tg.name.toLowerCase().includes(q)) : tags),
    [tags, q],
  );
  const exact = tags.some((tg) => tg.name.trim().toLowerCase() === q);

  const add = async (payload: { tag_id: string } | { name: string; color: string }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.conversation_tag) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.tag && !tagsById.has(data.tag.id)) onTagCreated(data.tag as Tag);
      const link = data.conversation_tag as ConversationTagLink;
      onLinksChange(conversationId, [...links.filter((l) => l.tag_id !== link.tag_id), link]);
      setQuery("");
    } catch (err) {
      toast.error(t("inboxpro.tags.failed", { reason: err instanceof Error ? err.message : "error" }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tagId: string) => {
    const before = links;
    onLinksChange(conversationId, links.filter((l) => l.tag_id !== tagId));
    try {
      const res = await fetch(`/api/conversations/${conversationId}/tags?tag_id=${tagId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      onLinksChange(conversationId, before);
      toast.error(t("inboxpro.tags.failed", { reason: err instanceof Error ? err.message : "error" }));
    }
  };

  const toggle = (tagId: string) => {
    if (busy) return;
    if (applied.has(tagId)) void remove(tagId);
    else void add({ tag_id: tagId });
  };

  const create = () => {
    const name = query.trim();
    if (!name || busy) return;
    const color = NEW_TAG_COLORS[tags.length % NEW_TAG_COLORS.length];
    void add({ name, color });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {links.map((l) => {
        const tag = tagsById.get(l.tag_id);
        if (!tag) return null;
        return (
          <TagChip
            key={l.id}
            name={tag.name}
            color={tag.color}
            onRemove={() => void remove(l.tag_id)}
            removeLabel={t("inboxpro.tags.remove", { name: tag.name })}
          />
        );
      })}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-slate-600 px-2 text-xs text-slate-300 hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("inboxpro.tags.add")}
        >
          {links.length ? <Plus className="h-3 w-3" aria-hidden="true" /> : <TagIcon className="h-3 w-3" aria-hidden="true" />}
          <span>{links.length ? t("inboxpro.tags.addShort") : t("inboxpro.tags.add")}</span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          initialFocus={inputRef}
          className="w-64 border border-slate-700 bg-slate-800 p-2 text-slate-100"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const first = visible[0];
                if (first && (exact || !canCreate)) toggle(first.id);
                else if (canCreate && q) create();
                else if (first) toggle(first.id);
              }
            }}
            placeholder={t("inboxpro.tags.search")}
            aria-label={t("inboxpro.tags.search")}
            className="h-8 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-white placeholder-slate-400 outline-none focus:border-primary"
          />
          <div className="max-h-56 overflow-y-auto" role="group" aria-label={t("inboxpro.tags.button")}>
            {visible.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-400">
                {tags.length ? t("inboxpro.tags.empty") : t("inboxpro.tags.none")}
              </p>
            )}
            {visible.map((tg) => {
              const on = applied.has(tg.id);
              return (
                <button
                  key={tg.id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(tg.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-700 focus-visible:bg-slate-700 focus-visible:outline-none disabled:opacity-60",
                    on ? "text-white" : "text-slate-300",
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tg.color }} aria-hidden="true" />
                  <span className="flex-1 truncate">{tg.name}</span>
                  {on && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {q && !exact && (
            canCreate ? (
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded border-t border-slate-700 px-2 py-1.5 text-left text-sm text-primary hover:bg-slate-700 focus-visible:bg-slate-700 focus-visible:outline-none disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate">{t("inboxpro.tags.create", { name: query.trim() })}</span>
              </button>
            ) : (
              <p className="border-t border-slate-700 px-1 pt-2 text-[11px] text-slate-400">
                {t("inboxpro.tags.createAdminOnly")}
              </p>
            )
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
