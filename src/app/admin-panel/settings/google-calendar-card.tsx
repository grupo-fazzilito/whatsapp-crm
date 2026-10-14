"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

interface GoogleSettings {
  configured: boolean;
  source: "panel" | "env" | null;
  client_id: string;
  secret_hint: string | null;
  panel_client_id: string;
  redirect_uri: string;
  webhook_url: string;
  push_supported: boolean;
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function CopyField({ id, label, value, help }: { id: string; label: string; value: string; help: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the field is selectable */
    }
  };
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={inputCls + " font-mono text-xs"} aria-describedby={`${id}-help`} />
        <button type="button" onClick={copy} className={cn(btnCls, "shrink-0 border border-slate-700 text-slate-200 hover:bg-slate-800")}>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? t("gcal.admin.copied") : t("gcal.admin.copy")}
          <span className="sr-only"> {label}</span>
        </button>
      </div>
      <p id={`${id}-help`} className="mt-1 text-xs text-slate-500">
        {help}
      </p>
    </div>
  );
}

/** Platform admin: Google OAuth client for the Google Calendar integration. */
export function GoogleCalendarCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/google/admin", { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(t("common.error"));
        return;
      }
      const data: GoogleSettings = await res.json();
      setSettings(data);
      setClientId(data.panel_client_id || data.client_id);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const put = async (patch: Record<string, unknown>) => {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/integrations/google/admin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? t("common.error"));
      return false;
    }
    setSettings(data);
    setClientId(data.panel_client_id || data.client_id);
    return true;
  };

  const save = async () => {
    const patch: Record<string, unknown> = { client_id: clientId.trim() || null };
    if (secret.trim()) patch.client_secret = secret.trim();
    if (await put(patch)) {
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("gcal.admin.removeConfirm"))) return;
    await put({ client_id: null, client_secret: null });
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-slate-500" aria-label={t("common.loading")} />}
      </div>
    );
  }

  const dirty = !!secret.trim() || clientId.trim() !== (settings.panel_client_id || settings.client_id);
  const needsSecret = !settings.secret_hint || settings.source !== "panel";

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5" aria-labelledby="gcal-admin-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="gcal-admin-title" className="text-sm font-bold text-white flex items-center gap-2">
            <CalendarDays className="size-4 text-emerald-400" aria-hidden /> {t("gcal.admin.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t("gcal.admin.subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            settings.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
          )}
        >
          {settings.configured ? t("gcal.admin.configured") : t("gcal.admin.notConfigured")}
          {settings.source ? ` · ${settings.source === "panel" ? t("gcal.admin.sourcePanel") : t("gcal.admin.sourceEnv")}` : ""}
          {settings.secret_hint ? ` · ${settings.secret_hint}` : ""}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="gcal-client-id" className={labelCls}>
            {t("gcal.admin.clientId")}
          </label>
          <input
            id="gcal-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={t("gcal.admin.clientIdPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className={inputCls + " font-mono"}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="gcal-client-secret" className={labelCls}>
            {settings.secret_hint ? t("gcal.admin.replaceSecret") : t("gcal.admin.clientSecret")}
          </label>
          <div className="relative">
            <input
              id="gcal-client-secret"
              type={show ? "text" : "password"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t("gcal.admin.secretPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className={inputCls + " pr-10 font-mono"}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar" : "Mostrar"}
              aria-pressed={show}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || !clientId.trim() || (needsSecret && !secret.trim())}
          className={cn(btnCls, "bg-emerald-600 text-white hover:bg-emerald-500")}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saved ? t("gcal.admin.saved") : t("gcal.admin.save")}
        </button>
        {settings.source === "panel" && (
          <button type="button" onClick={remove} className={cn(btnCls, "text-red-300 hover:bg-red-500/10")}>
            <Trash2 className="size-3.5" aria-hidden /> {t("gcal.admin.remove")}
          </button>
        )}
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
        >
          Google Cloud Console <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <CopyField id="gcal-redirect-uri" label={t("gcal.admin.redirectUri")} value={settings.redirect_uri} help={t("gcal.admin.redirectHelp")} />
      <CopyField id="gcal-webhook-url" label={t("gcal.admin.webhookUrl")} value={settings.webhook_url} help={t("gcal.admin.webhookHelp")} />
      {!settings.push_supported && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{t("gcal.admin.pushOff")}</p>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("gcal.admin.setupTitle")}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-300">
          <li>{t("gcal.admin.setup1")}</li>
          <li>{t("gcal.admin.setup2")}</li>
          <li>{t("gcal.admin.setup3")}</li>
          <li>{t("gcal.admin.setup4")}</li>
          <li>{t("gcal.admin.setup5")}</li>
        </ol>
      </div>
    </section>
  );
}
