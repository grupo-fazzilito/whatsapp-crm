"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, Loader2, Save } from "lucide-react";
import { useI18n } from "@/i18n/client";

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50";
const labelCls = "block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5";

interface View {
  webchat_key: string;
  whatsapp: string;
  channels: { key: string; name: string; workspace: string }[];
}

/** Platform admin: where the businesses' "?" → Live chat goes. */
export function SupportCard() {
  const { t } = useI18n();
  const [v, setV] = useState<View | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/support", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setV(d))
      .catch(() => {});
  }, []);

  if (!v) return <div className="rounded-xl border border-slate-800 bg-slate-900 p-6"><Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} /></div>;

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await fetch("/api/admin/settings/support", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webchat_key: v.webchat_key, whatsapp: v.whatsapp }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(d.error ?? t("common.error"));
    setV(d);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <section className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6" aria-labelledby="support-admin-title">
      <div>
        <h2 id="support-admin-title" className="flex items-center gap-2 text-sm font-bold text-white">
          <LifeBuoy className="size-4 text-emerald-400" aria-hidden /> {t("supportAdmin.settings.title")}
        </h2>
        <p className="mt-1 text-xs text-slate-400">{t("supportAdmin.settings.subtitle")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sup-chat" className={labelCls}>{t("supportAdmin.settings.chat")}</label>
          <select id="sup-chat" value={v.webchat_key} onChange={(e) => setV({ ...v, webchat_key: e.target.value })} className={inputCls} aria-describedby="sup-chat-help">
            <option value="">{t("supportAdmin.settings.none")}</option>
            {v.channels.map((c) => <option key={c.key} value={c.key}>{c.workspace} — {c.name}</option>)}
          </select>
          <p id="sup-chat-help" className="mt-1 text-xs text-slate-400">{t("supportAdmin.settings.chatHelp")}</p>
        </div>
        <div>
          <label htmlFor="sup-wa" className={labelCls}>{t("supportAdmin.settings.whatsapp")}</label>
          <input id="sup-wa" inputMode="numeric" value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value.replace(/[^\d]/g, "") })} placeholder="51999888777" className={inputCls} aria-describedby="sup-wa-help" />
          <p id="sup-wa-help" className="mt-1 text-xs text-slate-400">{t("supportAdmin.settings.whatsappHelp")}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400">{t("supportAdmin.settings.email")}</p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        {saved ? t("supportAdmin.settings.saved") : t("supportAdmin.settings.save")}
      </button>
    </section>
  );
}
