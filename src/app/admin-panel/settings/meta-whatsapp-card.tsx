"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Eye, EyeOff, Loader2, MessageCircle, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

type Source = "panel" | "env" | null;

interface MetaSettings {
  configured: boolean;
  app_id: string;
  panel_app_id: string;
  secret_hint: string | null;
  verify_token: string;
  es_config_id: string;
  es_coex_config_id: string;
  login_config_id: string;
  graph_version: string;
  effective: { graph_version: string; es_config_id: string; login_config_id: string };
  sources: { appId: Source; appSecret: Source; verifyToken: Source; esConfigId: Source; loginConfigId: Source };
  webhook_url: string;
  default_graph_version: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50 transition-colors";
const labelCls = "block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50 disabled:cursor-not-allowed";

const WEBHOOK_FIELDS = ["messages", "smb_message_echoes", "history", "smb_app_state_sync", "account_update", "message_template_status_update", "calls"];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked: the field stays selectable */
    }
  };
  return { copied, copy };
}

/** Platform admin: the Meta app behind WhatsApp Embedded Signup, Messenger/Instagram login and the webhook. */
export function MetaWhatsAppCard() {
  const { t } = useI18n();
  const { copied, copy } = useCopy();
  const [s, setS] = useState<MetaSettings | null>(null);
  const [form, setForm] = useState({ app_id: "", es_config_id: "", es_coex_config_id: "", login_config_id: "", graph_version: "", verify_token: "" });
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (d: MetaSettings) => {
    setS(d);
    setForm({
      app_id: d.panel_app_id || d.app_id,
      es_config_id: d.es_config_id,
      es_coex_config_id: d.es_coex_config_id,
      login_config_id: d.login_config_id,
      graph_version: d.graph_version,
      verify_token: d.verify_token,
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/meta", { cache: "no-store" }).then(async (res) => {
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
    const res = await fetch("/api/admin/settings/meta", {
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
    apply(data);
    return true;
  };

  const save = async () => {
    const patch: Record<string, unknown> = {
      app_id: form.app_id.trim() || null,
      es_config_id: form.es_config_id.trim() || null,
      es_coex_config_id: form.es_coex_config_id.trim() || null,
      login_config_id: form.login_config_id.trim() || null,
      graph_version: form.graph_version.trim() || null,
    };
    if (form.verify_token.trim() !== (s?.verify_token ?? "")) patch.verify_token = form.verify_token.trim() || null;
    if (secret.trim()) patch.app_secret = secret.trim();
    if (await put(patch)) {
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const removeSecret = async () => {
    if (!window.confirm(t("metawa.admin.removeSecretConfirm"))) return;
    await put({ app_secret: null });
  };

  if (!s) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />}
      </div>
    );
  }

  const src = (v: Source) => (v === "panel" ? t("metawa.admin.sourcePanel") : v === "env" ? t("metawa.admin.sourceEnv") : t("metawa.admin.sourceNone"));
  const text = (id: keyof typeof form, label: string, help: string, placeholder = "") => (
    <div>
      <label htmlFor={`meta-${id}`} className={labelCls}>
        {label}
      </label>
      <input
        id={`meta-${id}`}
        value={form[id]}
        onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`meta-${id}-help`}
        className={inputCls + " font-mono"}
      />
      <p id={`meta-${id}-help`} className="mt-1 text-xs text-slate-400">
        {help}
      </p>
    </div>
  );

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5" aria-labelledby="meta-admin-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="meta-admin-title" className="text-sm font-bold text-white flex items-center gap-2">
            <MessageCircle className="size-4 text-emerald-400" aria-hidden /> {t("metawa.admin.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t("metawa.admin.subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            s.configured && s.effective.es_config_id
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300",
          )}
        >
          {s.configured && s.effective.es_config_id ? t("metawa.admin.ready") : t("metawa.admin.incomplete")}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {text("app_id", t("metawa.admin.appId"), src(s.sources.appId), "1234567890")}
        <div>
          <label htmlFor="meta-app-secret" className={labelCls}>
            {s.secret_hint ? t("metawa.admin.replaceSecret") : t("metawa.admin.appSecret")}
          </label>
          <div className="relative">
            <input
              id="meta-app-secret"
              type={show ? "text" : "password"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={s.secret_hint ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="meta-app-secret-help"
              className={inputCls + " pr-10 font-mono"}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? t("metawa.admin.hide") : t("metawa.admin.show")}
              aria-pressed={show}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          <p id="meta-app-secret-help" className="mt-1 text-xs text-slate-400">
            {src(s.sources.appSecret)}
            {s.secret_hint ? ` · ${s.secret_hint}` : ""} · {t("metawa.admin.secretHelp")}
          </p>
        </div>
        {text("es_config_id", t("metawa.admin.esConfigId"), t("metawa.admin.esConfigHelp"))}
        {text("es_coex_config_id", t("metawa.admin.coexConfigId"), t("metawa.admin.coexConfigHelp"))}
        {text("login_config_id", t("metawa.admin.loginConfigId"), t("metawa.admin.loginConfigHelp"))}
        {text("graph_version", t("metawa.admin.graphVersion"), t("metawa.admin.graphVersionHelp", { version: s.effective.graph_version }), s.default_graph_version)}
      </div>

      <div>
        <label htmlFor="meta-verify_token" className={labelCls}>
          {t("metawa.admin.verifyToken")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="meta-verify_token"
            value={form.verify_token}
            onChange={(e) => setForm((f) => ({ ...f, verify_token: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="meta-verify_token-help"
            className={inputCls + " font-mono text-xs flex-1 min-w-[12rem]"}
          />
          <button type="button" onClick={() => put({ generate_verify_token: true })} disabled={saving} className={cn(btnCls, "border border-slate-700 text-slate-200 hover:bg-slate-800")}>
            <RefreshCw className="size-3.5" aria-hidden /> {t("metawa.admin.generate")}
          </button>
          <button type="button" onClick={() => copy("vt", form.verify_token)} disabled={!form.verify_token} className={cn(btnCls, "border border-slate-700 text-slate-200 hover:bg-slate-800")}>
            {copied === "vt" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied === "vt" ? t("metawa.admin.copied") : t("metawa.admin.copy")}
            <span className="sr-only"> {t("metawa.admin.verifyToken")}</span>
          </button>
        </div>
        <p id="meta-verify_token-help" className="mt-1 text-xs text-slate-400">
          {src(s.sources.verifyToken)} · {t("metawa.admin.verifyTokenHelp")}
        </p>
      </div>

      <div>
        <label htmlFor="meta-webhook-url" className={labelCls}>
          {t("metawa.admin.webhookUrl")}
        </label>
        <div className="flex gap-2">
          <input id="meta-webhook-url" readOnly value={s.webhook_url} onFocus={(e) => e.currentTarget.select()} className={inputCls + " font-mono text-xs"} />
          <button type="button" onClick={() => copy("url", s.webhook_url)} className={cn(btnCls, "shrink-0 border border-slate-700 text-slate-200 hover:bg-slate-800")}>
            {copied === "url" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied === "url" ? t("metawa.admin.copied") : t("metawa.admin.copy")}
            <span className="sr-only"> {t("metawa.admin.webhookUrl")}</span>
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {t("metawa.admin.webhookFields")} <span className="font-mono text-slate-300">{WEBHOOK_FIELDS.join(", ")}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={saving} className={cn(btnCls, "bg-emerald-600 text-white hover:bg-emerald-500")}>
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saved ? t("metawa.admin.saved") : t("metawa.admin.save")}
        </button>
        {s.sources.appSecret === "panel" && (
          <button type="button" onClick={removeSecret} className={cn(btnCls, "text-red-300 hover:bg-red-500/10")}>
            <Trash2 className="size-3.5" aria-hidden /> {t("metawa.admin.removeSecret")}
          </button>
        )}
        <a
          href="https://developers.facebook.com/docs/whatsapp/embedded-signup"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded text-xs text-emerald-400 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {t("metawa.admin.docs")} <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">{t("metawa.newTab")}</span>
        </a>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t("metawa.admin.setupTitle")}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-300">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <li key={n}>{t(`metawa.admin.setup${n}`)}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
