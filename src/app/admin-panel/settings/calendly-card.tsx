"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { CopyField } from "./google-calendar-card";

interface CalendlySettings {
  configured: boolean;
  source: "panel" | "env" | null;
  client_id: string;
  secret_hint: string | null;
  signing_key_set: boolean;
  panel_client_id: string;
  redirect_uri: string;
  webhook_url: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Platform admin: the Calendly OAuth app used by every workspace's Calendly connection. */
export function CalendlyCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<CalendlySettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [signingKey, setSigningKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/calendly/admin", { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) return setError(t("common.error"));
      const data: CalendlySettings = await res.json();
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
    const res = await fetch("/api/integrations/calendly/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
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
    if (signingKey.trim()) patch.webhook_signing_key = signingKey.trim();
    if (await put(patch)) {
      setSecret("");
      setSigningKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("calendly.admin.removeConfirm"))) return;
    await put({ client_id: null, client_secret: null, webhook_signing_key: null });
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-slate-500" aria-label={t("common.loading")} />}
      </div>
    );
  }

  const needsSecret = !settings.secret_hint || settings.source !== "panel";
  const dirty = !!secret.trim() || !!signingKey.trim() || clientId.trim() !== (settings.panel_client_id || settings.client_id);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5" aria-labelledby="calendly-admin-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="calendly-admin-title" className="text-sm font-bold text-white flex items-center gap-2">
            <CalendarClock className="size-4 text-emerald-400" aria-hidden /> {t("calendly.admin.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t("calendly.admin.subtitle")}</p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", settings.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300")}>
          {settings.configured ? t("calendly.admin.configured") : t("calendly.admin.notConfigured")}
          {settings.secret_hint ? ` · ${settings.secret_hint}` : ""}
          {settings.configured ? ` · ${settings.signing_key_set ? t("calendly.admin.signingSet") : t("calendly.admin.signingMissing")}` : ""}
        </span>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label htmlFor="calendly-client-id" className={labelCls}>{t("calendly.admin.clientId")}</label>
          <input id="calendly-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} className={inputCls} />
        </div>
        <div>
          <label htmlFor="calendly-client-secret" className={labelCls}>{settings.secret_hint ? t("calendly.admin.replaceSecret") : t("calendly.admin.clientSecret")}</label>
          <input id="calendly-client-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t("calendly.admin.secretPlaceholder")} autoComplete="off" spellCheck={false} className={inputCls} />
        </div>
        <div>
          <label htmlFor="calendly-signing-key" className={labelCls}>{settings.signing_key_set ? t("calendly.admin.replaceSigningKey") : t("calendly.admin.signingKey")}</label>
          <input id="calendly-signing-key" type="password" value={signingKey} onChange={(e) => setSigningKey(e.target.value)} placeholder={t("calendly.admin.secretPlaceholder")} autoComplete="off" spellCheck={false} className={inputCls} aria-describedby="calendly-signing-help" />
          <p id="calendly-signing-help" className="mt-1 text-xs text-slate-500">{t("calendly.admin.signingHelp")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!dirty || saving || !clientId.trim() || (needsSecret && !secret.trim())} className={cn(btnCls, "bg-emerald-600 text-white hover:bg-emerald-500")}>
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saved ? t("calendly.admin.saved") : t("calendly.admin.save")}
        </button>
        {settings.source === "panel" && (
          <button type="button" onClick={remove} className={cn(btnCls, "text-red-300 hover:bg-red-500/10")}>
            <Trash2 className="size-3.5" aria-hidden /> {t("calendly.admin.remove")}
          </button>
        )}
        <a href="https://developer.calendly.com/" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
          developer.calendly.com <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <CopyField id="calendly-redirect-uri" label={t("calendly.admin.redirectUri")} value={settings.redirect_uri} help={t("calendly.admin.redirectHelp")} />
      <CopyField id="calendly-webhook-url" label={t("calendly.admin.webhookUrl")} value={settings.webhook_url} help={t("calendly.admin.webhookHelp")} />

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("calendly.admin.setupTitle")}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-300">
          <li>{t("calendly.admin.setup1")}</li>
          <li>{t("calendly.admin.setup2")}</li>
          <li>{t("calendly.admin.setup3")}</li>
          <li>{t("calendly.admin.setup4")}</li>
        </ol>
      </div>
    </section>
  );
}
