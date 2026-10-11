"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  Check, ChevronDown, ChevronRight, Copy, KeyRound, ListChecks, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, Webhook,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminShell } from "../admin-shell";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { PLATFORM_EVENT_GROUPS } from "@/lib/webhooks/platform-events";

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failure_count: number;
  disabled_at: string | null;
  disabled_reason: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

type DeliveryStatus = "pending" | "delivered" | "failed";

interface Delivery {
  id: string;
  workspace_id: string | null;
  workspace_name: string | null;
  event_type: string;
  payload: unknown;
  status: DeliveryStatus;
  attempts: number;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface Attempt {
  delivered: boolean;
  status: number | null;
  durationMs: number;
  error?: string;
}

const DELIVERY_FILTERS = ["all", "pending", "delivered", "failed"] as const;
type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

const STATUS_DARK: Record<DeliveryStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  delivered: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50";
const labelCls = "block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5";
const primaryBtn =
  "flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";
const dangerBtn =
  "flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400";
const ghostBtn =
  "flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const eventKey = (type: string) => type.replace(/\./g, "_");

async function jsonOrNull(res: Response | null): Promise<Record<string, unknown> | null> {
  if (!res) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export default function AdminWebhooksPage() {
  const { t, locale } = useI18n();
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Endpoint | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "delete"; endpoint: Endpoint } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<Endpoint | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PE", { dateStyle: "medium", timeStyle: "short" });
  const errorText = useCallback(
    (code: unknown) => {
      const key = `platformHooks.errors.${typeof code === "string" ? code : "generic"}`;
      const msg = t(key);
      return msg === key ? t("platformHooks.errors.generic") : msg;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoadError(false);
    const res = await fetch("/api/admin/webhooks", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await jsonOrNull(res) : null;
    if (!body) {
      setLoadError(true);
      setEndpoints((prev) => prev ?? []);
      return;
    }
    setEndpoints((body.endpoints as Endpoint[]) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const replace = (ep: Endpoint) => setEndpoints((list) => (list ?? []).map((e) => (e.id === ep.id ? ep : e)));

  const toggleActive = async (ep: Endpoint) => {
    setToggling(ep.id);
    const res = await fetch(`/api/admin/webhooks/${ep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !ep.active }),
    }).catch(() => null);
    const body = await jsonOrNull(res);
    setToggling(null);
    if (!res?.ok || !body?.endpoint) return toast.error(errorText(body?.error));
    replace(body.endpoint as Endpoint);
    toast.success(t(ep.active ? "platformHooks.disabledToast" : "platformHooks.enabledToast"));
  };

  const sendTest = async (ep: Endpoint) => {
    setTesting(ep.id);
    const res = await fetch(`/api/admin/webhooks/${ep.id}/test`, { method: "POST" }).catch(() => null);
    const body = (await jsonOrNull(res)) as (Attempt & { error?: string }) | null;
    setTesting(null);
    if (!res?.ok || !body) return toast.error(errorText(body?.error));
    if (body.delivered) toast.success(t("platformHooks.test.ok", { status: body.status ?? "—", ms: body.durationMs }));
    else if (body.error) toast.error(t("platformHooks.test.fail", { error: body.error }));
    else toast.error(t("platformHooks.test.failStatus", { status: body.status ?? "—", ms: body.durationMs }));
    void load();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, endpoint } = confirm;
    setConfirmBusy(true);
    const res = await fetch(
      kind === "rotate" ? `/api/admin/webhooks/${endpoint.id}/rotate-secret` : `/api/admin/webhooks/${endpoint.id}`,
      { method: kind === "rotate" ? "POST" : "DELETE" },
    ).catch(() => null);
    const body = await jsonOrNull(res);
    setConfirmBusy(false);
    if (!res?.ok) return toast.error(errorText(body?.error));
    setConfirm(null);
    if (kind === "rotate") {
      setSecret(String(body?.secret ?? ""));
    } else {
      setEndpoints((list) => (list ?? []).filter((e) => e.id !== endpoint.id));
      toast.success(t("platformHooks.delete.done"));
    }
  };

  const eventsSummary = (events: string[]) =>
    events.includes("*") ? t("platformHooks.summary.all") : t("platformHooks.summary.count", { count: events.length });

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
              <Webhook className="size-6 text-emerald-400" aria-hidden /> {t("platformHooks.title")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">{t("platformHooks.subtitle")}</p>
          </div>
          <button type="button" onClick={() => setEditing("new")} className={primaryBtn}>
            <Plus className="size-4" aria-hidden /> {t("platformHooks.add")}
          </button>
        </div>

        {loadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {t("platformHooks.loadError")}
            <button type="button" onClick={() => void load()} className={ghostBtn}>
              <RefreshCw className="size-3.5" aria-hidden /> {t("platformHooks.retry")}
            </button>
          </div>
        )}

        {!endpoints ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />
          </div>
        ) : endpoints.length === 0 ? (
          !loadError && (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
              <Webhook className="mx-auto size-8 text-slate-600" aria-hidden />
              <p className="mt-3 text-sm text-slate-400">{t("platformHooks.empty")}</p>
            </div>
          )
        ) : (
          <ul className="space-y-3">
            {endpoints.map((ep) => {
              const statusLine = ep.active
                ? ep.failure_count > 0
                  ? t("platformHooks.status.failures", { count: ep.failure_count })
                  : null
                : ep.disabled_reason === "consecutive_failures"
                  ? t("platformHooks.status.auto", { count: ep.failure_count })
                  : t("platformHooks.status.manual");
              return (
                <li key={ep.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-sm font-medium text-white">{ep.url}</p>
                      <p className={cn("mt-1 text-sm", ep.description ? "text-slate-300" : "text-slate-500 italic")}>
                        {ep.description || t("platformHooks.noDescription")}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ep.active}
                      aria-label={t("platformHooks.toggle", { url: ep.url })}
                      disabled={toggling === ep.id}
                      onClick={() => void toggleActive(ep)}
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                        ep.active ? "bg-emerald-600" : "bg-slate-700",
                      )}
                    >
                      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", ep.active ? "translate-x-5" : "translate-x-0.5")} />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", ep.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700 text-slate-300")}>
                      {t(ep.active ? "platformHooks.status.active" : "platformHooks.status.disabled")}
                    </span>
                    {statusLine && <span className={cn(ep.active ? "text-amber-300" : "text-red-300")}>{statusLine}</span>}
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">{eventsSummary(ep.events)}</span>
                  </div>

                  <dl className="mt-3 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt>{t("platformHooks.lastSuccess")}:</dt>
                      <dd className="text-slate-300">{ep.last_success_at ? fmt.format(new Date(ep.last_success_at)) : t("platformHooks.never")}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t("platformHooks.lastFailure")}:</dt>
                      <dd className="text-slate-300">{ep.last_failure_at ? fmt.format(new Date(ep.last_failure_at)) : t("platformHooks.never")}</dd>
                    </div>
                  </dl>

                  <div role="group" aria-label={t("platformHooks.actions.menu", { url: ep.url })} className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setEditing(ep)} className={ghostBtn}>
                      <Pencil className="size-3.5" aria-hidden /> {t("platformHooks.actions.edit")}
                    </button>
                    <button type="button" onClick={() => void sendTest(ep)} disabled={testing === ep.id} className={ghostBtn}>
                      {testing === ep.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                      {t(testing === ep.id ? "platformHooks.actions.testing" : "platformHooks.actions.test")}
                    </button>
                    <button type="button" onClick={() => setDeliveriesFor(ep)} className={ghostBtn}>
                      <ListChecks className="size-3.5" aria-hidden /> {t("platformHooks.actions.deliveries")}
                    </button>
                    <button type="button" onClick={() => setConfirm({ kind: "rotate", endpoint: ep })} className={ghostBtn}>
                      <KeyRound className="size-3.5" aria-hidden /> {t("platformHooks.actions.rotate")}
                    </button>
                    <button type="button" onClick={() => setConfirm({ kind: "delete", endpoint: ep })} className={cn(ghostBtn, "border-red-500/40 text-red-300 hover:bg-red-500/10")}>
                      <Trash2 className="size-3.5" aria-hidden /> {t("platformHooks.actions.delete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <EndpointDialog
          key={editing === "new" ? "new" : editing?.id ?? "closed"}
          target={editing}
          onClose={() => setEditing(null)}
          errorText={errorText}
          onSaved={(ep, newSecret) => {
            setEditing(null);
            if (newSecret) {
              setEndpoints((list) => [...(list ?? []), ep]);
              setSecret(newSecret);
              toast.success(t("platformHooks.form.created"));
            } else {
              replace(ep);
              toast.success(t("platformHooks.form.saved"));
            }
          }}
        />

        <SecretDialog secret={secret} onClose={() => setSecret(null)} />

        <Dialog open={!!confirm} onOpenChange={(o) => !o && !confirmBusy && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t(confirm?.kind === "rotate" ? "platformHooks.rotate.title" : "platformHooks.delete.title")}</DialogTitle>
              <DialogDescription className="break-all">
                {confirm ? t(confirm.kind === "rotate" ? "platformHooks.rotate.body" : "platformHooks.delete.body", { url: confirm.endpoint.url }) : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" onClick={() => setConfirm(null)} disabled={confirmBusy} className={ghostBtn}>
                {t("platformHooks.form.cancel")}
              </button>
              <button type="button" onClick={() => void runConfirm()} disabled={confirmBusy} className={confirm?.kind === "delete" ? dangerBtn : primaryBtn}>
                {confirmBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {confirm?.kind === "rotate"
                  ? t(confirmBusy ? "platformHooks.rotate.rotating" : "platformHooks.rotate.confirm")
                  : t(confirmBusy ? "platformHooks.delete.deleting" : "platformHooks.delete.confirm")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeliveriesDialog endpoint={deliveriesFor} onClose={() => setDeliveriesFor(null)} errorText={errorText} />
      </div>
    </AdminShell>
  );
}

// ------------------------------------------------------------
// Create / edit
// ------------------------------------------------------------

function EndpointDialog({
  target,
  onClose,
  onSaved,
  errorText,
}: {
  target: Endpoint | "new" | null;
  onClose: () => void;
  onSaved: (ep: Endpoint, secret?: string) => void;
  errorText: (code: unknown) => string;
}) {
  const { t } = useI18n();
  const existing = target && target !== "new" ? target : null;
  const [url, setUrl] = useState(existing?.url ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [all, setAll] = useState(existing ? existing.events.includes("*") : false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing && !existing.events.includes("*") ? existing.events : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();

  const toggle = (events: readonly string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of events) {
        if (on) next.add(e);
        else next.delete(e);
      }
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const events = all ? ["*"] : [...selected];
    if (!events.length) return setError(errorText("events_required"));
    setBusy(true);
    const res = await fetch(existing ? `/api/admin/webhooks/${existing.id}` : "/api/admin/webhooks", {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim(), description: description.trim(), events }),
    }).catch(() => null);
    const body = await jsonOrNull(res);
    setBusy(false);
    if (!res?.ok || !body?.endpoint) return setError(errorText(body?.error));
    onSaved(body.endpoint as Endpoint, typeof body.secret === "string" ? body.secret : undefined);
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t(existing ? "platformHooks.form.editTitle" : "platformHooks.form.addTitle")}</DialogTitle>
            <DialogDescription>{t("platformHooks.form.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div>
              <label htmlFor={`${baseId}-url`} className={labelCls}>{t("platformHooks.form.url")}</label>
              <input
                id={`${baseId}-url`}
                type="url"
                inputMode="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("platformHooks.form.urlPlaceholder")}
                aria-describedby={`${baseId}-url-hint`}
                className={inputCls}
                autoFocus
              />
              <p id={`${baseId}-url-hint`} className="mt-1 text-xs text-slate-400">{t("platformHooks.form.urlHint")}</p>
            </div>
            <div>
              <label htmlFor={`${baseId}-desc`} className={labelCls}>{t("platformHooks.form.descriptionLabel")}</label>
              <input
                id={`${baseId}-desc`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                placeholder={t("platformHooks.form.descriptionPlaceholder")}
                className={inputCls}
              />
            </div>

            <fieldset>
              <legend className={labelCls}>{t("platformHooks.form.events")}</legend>
              <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-3.5 py-3">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="mt-0.5 size-4 accent-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">{t("platformHooks.form.allEvents")}</span>
                  <span className="block text-xs text-slate-400">{t("platformHooks.form.allEventsHint")}</span>
                </span>
              </label>

              {!all && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-slate-400" aria-live="polite">{t("platformHooks.form.selected", { count: selected.size })}</p>
                  {PLATFORM_EVENT_GROUPS.map((g) => {
                    const on = g.events.filter((e) => selected.has(e)).length;
                    const groupName = t(`platformHooks.groups.${g.key}`);
                    return (
                      <fieldset key={g.key} className="rounded-xl border border-slate-700 px-3.5 py-3">
                        <legend className="sr-only">{groupName}</legend>
                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={on === g.events.length}
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && on < g.events.length;
                            }}
                            onChange={(e) => toggle(g.events, e.target.checked)}
                            aria-label={t("platformHooks.form.selectGroup", { group: groupName })}
                            className="size-4 accent-emerald-500"
                          />
                          <span className="text-sm font-semibold text-white">{groupName}</span>
                          <span className="ml-auto text-xs text-slate-500">{on}/{g.events.length}</span>
                        </label>
                        <div className="mt-2 grid gap-1.5 pl-7">
                          {g.events.map((ev) => (
                            <label key={ev} className="flex items-center gap-2.5 text-sm text-slate-200">
                              <input type="checkbox" checked={selected.has(ev)} onChange={(e) => toggle([ev], e.target.checked)} className="size-4 accent-emerald-500" />
                              <span className="min-w-0">
                                {t(`platformHooks.events.${eventKey(ev)}`)}
                                <span className="ml-1.5 font-mono text-[11px] text-slate-500">{ev}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          </div>

          <DialogFooter>
            <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>
              {t("platformHooks.form.cancel")}
            </button>
            <button type="submit" disabled={busy || !url.trim()} className={primaryBtn}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {busy ? t("platformHooks.form.saving") : t(existing ? "platformHooks.form.save" : "platformHooks.form.create")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Secret (shown once)
// ------------------------------------------------------------

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const fieldId = useId();

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("platformHooks.secret.copyFailed"));
    }
  };

  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("platformHooks.secret.title")}</DialogTitle>
          <DialogDescription>{t("platformHooks.secret.body")}</DialogDescription>
        </DialogHeader>
        <div>
          <label htmlFor={fieldId} className={labelCls}>{t("platformHooks.secret.label")}</label>
          <div className="flex gap-2">
            <input id={fieldId} readOnly value={secret ?? ""} onFocus={(e) => e.target.select()} className={cn(inputCls, "font-mono text-xs")} />
            <button type="button" onClick={() => void copy()} className={cn(ghostBtn, "shrink-0 rounded-xl px-3.5")}>
              {copied ? <Check className="size-4 text-emerald-400" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {t(copied ? "platformHooks.secret.copied" : "platformHooks.secret.copy")}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">{copied ? t("platformHooks.secret.copied") : ""}</span>
        </div>
        <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-3.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t("platformHooks.secret.verifyTitle")}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t("platformHooks.secret.verifyBody")}</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
{`X-Whasalia-Signature: t=<t>,v1=<hex>
v1 == HMAC_SHA256(secret, "<t>.<raw body>")`}
          </pre>
        </section>
        <DialogFooter>
          <button type="button" onClick={onClose} className={primaryBtn}>{t("platformHooks.secret.done")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Deliveries
// ------------------------------------------------------------

function DeliveriesDialog({
  endpoint,
  onClose,
  errorText,
}: {
  endpoint: Endpoint | null;
  onClose: () => void;
  errorText: (code: unknown) => string;
}) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<DeliveryFilter>("all");
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PE", { dateStyle: "short", timeStyle: "medium" });
  const endpointId = endpoint?.id ?? null;

  const load = useCallback(async () => {
    if (!endpointId) return;
    setFailed(false);
    const res = await fetch(`/api/admin/webhooks/${endpointId}/deliveries${filter === "all" ? "" : `?status=${filter}`}`, { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await jsonOrNull(res) : null;
    if (!body) {
      setFailed(true);
      setRows([]);
      return;
    }
    setRows((body.deliveries as Delivery[]) ?? []);
  }, [endpointId, filter]);

  useEffect(() => {
    if (!endpointId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open / filter change
    setRows(null);
    void load();
  }, [endpointId, load]);

  const close = () => {
    onClose();
    setFilter("all");
    setExpanded(null);
    setRows(null);
  };

  const resend = async (d: Delivery) => {
    setResending(d.id);
    const res = await fetch(`/api/admin/webhooks/deliveries/${d.id}/resend`, { method: "POST" }).catch(() => null);
    const body = (await jsonOrNull(res)) as (Attempt & { error?: string }) | null;
    setResending(null);
    if (!res?.ok || !body) return toast.error(errorText(body?.error));
    if (body.delivered) toast.success(t("platformHooks.deliveries.resent", { status: body.status ?? "—" }));
    else toast.error(t("platformHooks.deliveries.resendFailed", { error: body.error ?? `HTTP ${body.status ?? "—"}` }));
    void load();
  };

  const eventLabel = (type: string) => {
    const key = `platformHooks.events.${eventKey(type)}`;
    const label = t(key);
    return label === key ? type : label;
  };

  return (
    <Dialog open={!!endpoint} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("platformHooks.deliveries.title")}</DialogTitle>
          <DialogDescription className="break-all">{endpoint ? t("platformHooks.deliveries.description", { url: endpoint.url }) : ""}</DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div role="radiogroup" aria-label={t("platformHooks.deliveries.filterLabel")} className="flex flex-wrap gap-2">
              {DELIVERY_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                    filter === f ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-slate-700 text-slate-300 hover:bg-slate-800",
                  )}
                >
                  {t(`platformHooks.deliveries.filters.${f}`)}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void load()} className={cn(ghostBtn, "ml-auto")} aria-label={t("platformHooks.deliveries.refresh")}>
              <RefreshCw className="size-3.5" aria-hidden />
            </button>
          </div>
        </DialogHeader>

        {!rows ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />
          </div>
        ) : failed ? (
          <p role="alert" className="text-sm text-red-300">{t("platformHooks.errors.generic")}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("platformHooks.deliveries.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {rows.map((d) => {
              const open = expanded === d.id;
              const panelId = `delivery-${d.id}`;
              return (
                <li key={d.id}>
                  <div className="flex items-start gap-2 px-3 py-3">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setExpanded(open ? null : d.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />}
                      <span className="sr-only">{t(open ? "platformHooks.deliveries.hideDetails" : "platformHooks.deliveries.showDetails")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{eventLabel(d.event_type)}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_DARK[d.status])}>
                            {t(`platformHooks.deliveries.statuses.${d.status}`)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {d.workspace_name ?? t("platformHooks.deliveries.platform")} · {fmt.format(new Date(d.created_at))}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 tabular-nums">
                          {d.response_status !== null ? `HTTP ${d.response_status}` : t("platformHooks.deliveries.noResponse")}
                          {d.duration_ms !== null && <> · {t("platformHooks.deliveries.duration", { ms: d.duration_ms })}</>}
                          {" · "}
                          {t("platformHooks.deliveries.attempts", { count: d.attempts })}
                        </span>
                      </span>
                    </button>
                    <button type="button" onClick={() => void resend(d)} disabled={resending === d.id} className={cn(ghostBtn, "shrink-0")}>
                      {resending === d.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                      {t(resending === d.id ? "platformHooks.deliveries.resending" : "platformHooks.deliveries.resend")}
                    </button>
                  </div>
                  {open && (
                    <div id={panelId} className="space-y-3 px-3 pb-3">
                      {d.error && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("platformHooks.deliveries.error")}</p>
                          <p className="mt-1 break-all text-xs text-red-300">{d.error}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("platformHooks.deliveries.payload")}</p>
                        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
                          {JSON.stringify(d.payload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("platformHooks.deliveries.responseBody")}</p>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
                          {d.response_body || t("platformHooks.deliveries.empty_body")}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
