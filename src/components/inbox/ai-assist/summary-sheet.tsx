"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { assistErrorText, assistFetch } from "./api";
import { AssistSettings } from "./settings-panel";

interface Summary {
  key_points: string[];
  customer_intent: string;
  pending: string[];
  next_step: string;
}
interface SummaryResponse {
  summary: Summary | null;
  at: string | null;
  by: string | null;
}

interface SummarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** Display name of a workspace member (who generated the summary). */
  nameOf: (userId: string | null) => string | null;
  canManageSettings: boolean;
}

/** "Resumir": AI summary of the conversation, saved on it; regenerate on demand. */
export function SummarySheet({ open, onOpenChange, conversationId, nameOf, canManageSettings }: SummarySheetProps) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the saved summary when the sheet opens on a conversation.
  useEffect(() => {
    if (!open || loadedFor === conversationId) return;
    let cancelled = false;
    void assistFetch<SummaryResponse>(`conversations/${conversationId}/summary`, { method: "GET" }).then((r) => {
      if (cancelled) return;
      setLoadedFor(conversationId);
      setError(null);
      setData(r.ok ? r.data : { summary: null, at: null, by: null });
    });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, loadedFor]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const r = await assistFetch<SummaryResponse>(`conversations/${conversationId}/summary`);
    setBusy(false);
    if (!r.ok) {
      setError(assistErrorText(t, r.code, "text"));
      return;
    }
    setData(r.data);
  };

  const current = loadedFor === conversationId ? data : null;
  const summary = current?.summary ?? null;
  const when = current?.at ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(current.at)) : null;
  const by = nameOf(current?.by ?? null);

  const copy = async () => {
    if (!summary) return;
    const text = [
      `${t("aiassist.summary.keyPoints")}:`,
      ...summary.key_points.map((p) => `- ${p}`),
      "",
      `${t("aiassist.summary.intent")}: ${summary.customer_intent}`,
      "",
      `${t("aiassist.summary.pending")}:`,
      ...(summary.pending.length ? summary.pending.map((p) => `- ${p}`) : [`- ${t("aiassist.summary.noPending")}`]),
      "",
      `${t("aiassist.summary.nextStep")}: ${summary.next_step}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("aiassist.summary.copied"));
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("aiassist.summary.title")}
          </SheetTitle>
          <SheetDescription>{t("aiassist.summary.description")}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 p-4" aria-busy={busy}>
          {!current ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : summary ? (
            <>
              <section aria-labelledby="ai-sum-points">
                <h3 id="ai-sum-points" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("aiassist.summary.keyPoints")}
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {summary.key_points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
              {summary.customer_intent && (
                <section aria-labelledby="ai-sum-intent">
                  <h3 id="ai-sum-intent" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("aiassist.summary.intent")}
                  </h3>
                  <p className="text-sm">{summary.customer_intent}</p>
                </section>
              )}
              <section aria-labelledby="ai-sum-pending">
                <h3 id="ai-sum-pending" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("aiassist.summary.pending")}
                </h3>
                {summary.pending.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {summary.pending.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("aiassist.summary.noPending")}</p>
                )}
              </section>
              {summary.next_step && (
                <section aria-labelledby="ai-sum-next" className="rounded-lg border border-primary/40 bg-primary/10 p-3">
                  <h3 id="ai-sum-next" className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    {t("aiassist.summary.nextStep")}
                  </h3>
                  <p className="text-sm">{summary.next_step}</p>
                </section>
              )}
              {when && (
                <p className="text-xs text-muted-foreground">
                  {by ? t("aiassist.summary.updatedBy", { date: when, name: by }) : t("aiassist.summary.updated", { date: when })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("aiassist.summary.none")}</p>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void generate()} disabled={busy || !current}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : summary ? (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {busy ? t("aiassist.summary.generating") : summary ? t("aiassist.summary.regenerate") : t("aiassist.summary.generate")}
            </Button>
            {summary && (
              <Button type="button" variant="outline" onClick={() => void copy()}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("aiassist.summary.copy")}
              </Button>
            )}
          </div>
          <span className="sr-only" aria-live="polite">
            {busy ? t("aiassist.summary.generating") : ""}
          </span>

          <AssistSettings canManage={canManageSettings} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
