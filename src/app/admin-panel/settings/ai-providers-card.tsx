"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bot, CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

type Provider = "gemini" | "deepseek" | "openai";

interface ProviderStatus {
  id: Provider;
  configured: boolean;
  source: "panel" | "env" | null;
  hint: string | null;
}

interface AiSettings {
  provider_order: Provider[];
  models: Partial<Record<Provider, string>>;
  deepseek_base_url: string;
  providers: ProviderStatus[];
}

const META: Record<Provider, { name: string; defaultModel: string; models: string[]; keyUrl: string }> = {
  gemini: {
    name: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  deepseek: {
    name: "DeepSeek",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  openai: {
    name: "OpenAI / OpenRouter",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function AiProvidersCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/ai", { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (res.ok) setSettings(await res.json());
      else setError(t("common.error"));
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    const res = await fetch("/api/admin/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? t("common.error"));
      return false;
    }
    setSettings(data);
    return true;
  };

  const move = (i: number, dir: -1 | 1) => {
    if (!settings) return;
    const order = [...settings.provider_order];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    save({ provider_order: order });
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <Loader2 className="size-5 animate-spin text-slate-500" aria-label={t("common.loading")} />
      </div>
    );
  }

  const anyConfigured = settings.providers.some((p) => p.configured);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5" aria-labelledby="ai-providers-title">
      <div>
        <h2 id="ai-providers-title" className="text-sm font-bold text-white flex items-center gap-2">
          <Bot className="size-4 text-emerald-400" aria-hidden /> {t("admin.ai.title")}
        </h2>
        <p className="mt-1 text-xs text-slate-400">{t("admin.ai.subtitle")}</p>
      </div>

      {!anyConfigured && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {t("admin.ai.noneConfigured")}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div>
        <p className={labelCls}>{t("admin.ai.orderTitle")}</p>
        <p className="mb-2 text-xs text-slate-500">{t("admin.ai.orderHelp")}</p>
        <ol className="space-y-1.5">
          {settings.provider_order.map((p, i) => {
            const status = settings.providers.find((s) => s.id === p);
            return (
              <li key={p} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                <span className="w-5 text-xs font-bold text-slate-500">{i + 1}.</span>
                <span className={cn("flex-1 text-sm", status?.configured ? "text-white" : "text-slate-500")}>{META[p].name}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t("admin.ai.moveUp")} ${META[p].name}`} className={cn(btnCls, "text-slate-400 hover:text-white")}>
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === settings.provider_order.length - 1} aria-label={`${t("admin.ai.moveDown")} ${META[p].name}`} className={cn(btnCls, "text-slate-400 hover:text-white")}>
                  <ArrowDown className="size-4" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-4">
        {settings.providers.map((p) => (
          <ProviderRow key={p.id} status={p} model={settings.models[p.id] ?? ""} baseUrl={settings.deepseek_base_url} onSave={save} />
        ))}
      </div>
    </section>
  );
}

function ProviderRow({
  status,
  model: savedModel,
  baseUrl: savedBaseUrl,
  onSave,
}: {
  status: ProviderStatus;
  model: string;
  baseUrl: string;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const meta = META[status.id];
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(savedModel);
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = !!key.trim() || model !== savedModel || (status.id === "deepseek" && baseUrl !== savedBaseUrl);

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = { models: { [status.id]: model || null } };
    if (key.trim()) patch.keys = { [status.id]: key.trim() };
    if (status.id === "deepseek") patch.deepseek_base_url = baseUrl || null;
    if (await onSave(patch)) {
      setKey("");
      setResult(null);
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm(t("admin.ai.removeConfirm", { provider: meta.name }))) return;
    await onSave({ keys: { [status.id]: null } });
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const res = await fetch("/api/admin/settings/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: status.id, key: key.trim() || undefined, model: model || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setResult(
      res.ok && data.ok
        ? { ok: true, text: t("admin.ai.testOk", { ms: data.ms ?? 0 }) }
        : { ok: false, text: t("admin.ai.testFail", { error: data.error ?? res.status }) },
    );
    setTesting(false);
  };

  const keyId = `ai-key-${status.id}`;
  const modelId = `ai-model-${status.id}`;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{meta.name}</h3>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            status.source === "panel"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : status.source === "env"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                : "border-slate-700 bg-slate-800 text-slate-400",
          )}
        >
          {status.source === "panel" ? t("admin.ai.statusPanel") : status.source === "env" ? t("admin.ai.statusEnv") : t("admin.ai.statusNone")}
          {status.hint ? ` · ${status.hint}` : ""}
        </span>
        <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
          {t("admin.ai.getKey")} <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={keyId} className={labelCls}>
            {status.configured ? t("admin.ai.replaceKey") : t("admin.ai.newKey")}
          </label>
          <div className="relative">
            <input
              id={keyId}
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t("admin.ai.keyPlaceholder")}
              className={inputCls + " pr-10 font-mono"}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar" : "Mostrar"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={modelId} className={labelCls}>
            {t("admin.ai.model")}
          </label>
          <input
            id={modelId}
            list={`${modelId}-options`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("admin.ai.modelPlaceholder", { model: meta.defaultModel })}
            className={inputCls}
          />
          <datalist id={`${modelId}-options`}>
            {meta.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        {status.id === "deepseek" && (
          <div className="sm:col-span-2">
            <label htmlFor="ai-deepseek-url" className={labelCls}>
              {t("admin.ai.baseUrl")}
            </label>
            <input
              id="ai-deepseek-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
              className={inputCls}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!dirty || saving} className={cn(btnCls, "bg-emerald-600 text-white hover:bg-emerald-500")}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t("admin.settings.save")}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={testing || (!status.configured && !key.trim())}
          className={cn(btnCls, "border border-slate-700 text-slate-200 hover:bg-slate-800")}
        >
          {testing && <Loader2 className="size-3.5 animate-spin" />}
          {testing ? t("admin.ai.testing") : t("admin.ai.test")}
        </button>
        {status.source === "panel" && (
          <button type="button" onClick={remove} className={cn(btnCls, "text-red-300 hover:bg-red-500/10")}>
            <Trash2 className="size-3.5" /> {t("admin.ai.remove")}
          </button>
        )}
        {result && (
          <span role="status" className={cn("inline-flex items-center gap-1 text-xs", result.ok ? "text-emerald-300" : "text-red-300")}>
            {result.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
