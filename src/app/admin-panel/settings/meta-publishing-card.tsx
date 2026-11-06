"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { CopyField } from "./google-calendar-card";

interface PublishingSettings {
  configured: boolean;
  source: "panel" | "env" | null;
  app_id: string;
  panel_app_id: string;
  secret_hint: string | null;
  config_id: string;
  redirect_uri: string;
  scopes: string[];
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Platform admin: the second Meta app, only for Publicaciones (Facebook / Instagram posts). */
export function MetaPublishingCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PublishingSettings | null>(null);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [configId, setConfigId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (data: PublishingSettings) => {
    setSettings(data);
    setAppId(data.panel_app_id || data.app_id);
    setConfigId(data.config_id);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/meta-publishing", { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) return setError(t("common.error"));
      apply(await res.json());
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const put = async (patch: Record<string, unknown>) => {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/admin/settings/meta-publishing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? t("common.error"));
      return false;
    }
    apply(data);
    return true;
  };

  const save = async () => {
    const patch: Record<string, unknown> = { app_id: appId.trim() || null, config_id: configId.trim() || null };
    if (secret.trim()) patch.app_secret = secret.trim();
    if (await put(patch)) {
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("posts.admin.removeConfirm"))) return;
    await put({ app_id: null, app_secret: null, config_id: null });
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-slate-500" aria-label={t("common.loading")} />}
      </div>
    );
  }

  const needsSecret = !settings.secret_hint || settings.source !== "panel";
  const dirty = !!secret.trim() || appId.trim() !== (settings.panel_app_id || settings.app_id) || configId.trim() !== settings.config_id;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5" aria-labelledby="meta-publishing-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="meta-publishing-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Megaphone className="size-4 text-emerald-400" aria-hidden /> {t("posts.admin.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t("posts.admin.subtitle")}</p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", settings.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300")}>
          {settings.configured ? t("posts.admin.configured") : t("posts.admin.notConfigured")}
          {settings.secret_hint ? ` · ${settings.secret_hint}` : ""}
        </span>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mp-app-id" className={labelCls}>{t("posts.admin.appId")}</label>
          <input id="mp-app-id" value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} className={inputCls} />
        </div>
        <div>
          <label htmlFor="mp-secret" className={labelCls}>{settings.secret_hint ? t("posts.admin.replaceSecret") : t("posts.admin.appSecret")}</label>
          <input id="mp-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t("posts.admin.secretPlaceholder")} autoComplete="off" spellCheck={false} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="mp-config" className={labelCls}>{t("posts.admin.configId")}</label>
          <input id="mp-config" value={configId} onChange={(e) => setConfigId(e.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} className={inputCls} aria-describedby="mp-config-help" />
          <p id="mp-config-help" className="mt-1 text-xs text-slate-500">
            {t("posts.admin.configHelp")} <span className="font-mono text-slate-400">{settings.scopes.join(", ")}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!dirty || saving || !appId.trim() || (needsSecret && !secret.trim())} className={cn(btnCls, "bg-emerald-600 text-white hover:bg-emerald-500")}>
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saved ? t("posts.admin.saved") : t("posts.admin.save")}
        </button>
        {settings.source === "panel" && (
          <button type="button" onClick={remove} className={cn(btnCls, "text-red-300 hover:bg-red-500/10")}>
            <Trash2 className="size-3.5" aria-hidden /> {t("posts.admin.remove")}
          </button>
        )}
      </div>

      <CopyField id="mp-redirect" label={t("posts.admin.redirectUri")} value={settings.redirect_uri} help={t("posts.admin.redirectHelp")} />
    </section>
  );
}
