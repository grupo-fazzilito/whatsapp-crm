"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { apiJson } from "@/lib/crm/api-client";
import { DEFAULT_LOST_REASONS, MAX_LOST_REASONS, MAX_REASON_LENGTH, lostReasons, normalizeReasons } from "@/lib/crm/reasons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Admin editor for workspaces.settings.crm.lost_reasons. */
export function LostReasonsEditor() {
  const { t, locale } = useI18n();
  const { workspace, refresh } = useWorkspace();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(lostReasons(workspace?.settings, locale));
    setDirty(false);
  }, [workspace?.settings, locale]);

  const add = () => {
    const next = normalizeReasons([...list, draft]);
    if (next.length === list.length) return;
    setList(next);
    setDraft("");
    setDirty(true);
  };

  const save = async (next: string[] | null) => {
    if (!workspace) return;
    setSaving(true);
    // The route merges into the latest settings so other tabs' changes are kept.
    const ok = await apiJson("/api/crm/lost-reasons", { method: "PUT", body: { reasons: next } }).then(
      () => true,
      () => false,
    );
    setSaving(false);
    if (!ok) {
      toast.error(t("crm.reasons.saveFailed"));
      return;
    }
    await refresh();
    setDirty(false);
    toast.success(t("crm.reasons.saved"));
  };

  return (
    <div className="grid gap-2">
      <div>
        <p className="text-sm font-medium text-slate-300">{t("crm.reasons.title")}</p>
        <p className="text-xs text-slate-400">{t("crm.reasons.description")}</p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t("crm.reasons.title")}>
        {list.map((r) => (
          <li key={r} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 py-0.5 pl-2.5 pr-0.5 text-xs text-slate-200">
            {r}
            <button
              type="button"
              onClick={() => {
                setList(list.filter((x) => x !== r));
                setDirty(true);
              }}
              aria-label={t("crm.reasons.remove", { reason: r })}
              className="flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <label htmlFor="lost-reason-new" className="sr-only">
          {t("crm.reasons.new")}
        </label>
        <Input
          id="lost-reason-new"
          value={draft}
          maxLength={MAX_REASON_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("crm.reasons.new")}
          className="border-slate-700 bg-slate-800 text-sm text-white"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!draft.trim() || list.length >= MAX_LOST_REASONS}
          className="shrink-0 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
        >
          <Plus className="mr-1 h-3 w-3" />
          {t("crm.reasons.add")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => save(list)} disabled={saving || !dirty || list.length === 0}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t("crm.reasons.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => save(null)}
          disabled={saving}
          className="text-slate-400 hover:text-white"
          title={DEFAULT_LOST_REASONS[locale === "en" ? "en" : "es"].join(", ")}
        >
          <RotateCcw className="size-3.5" />
          {t("crm.reasons.reset")}
        </Button>
      </div>
    </div>
  );
}
