"use client";

import { useEffect, useState } from "react";
import { Settings, Shield, Bell, Users, Save, Loader2 } from "lucide-react";
import { AdminShell } from "../admin-shell";
import { AiProvidersCard } from "./ai-providers-card";
import { useI18n } from "@/i18n/client";

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const [general, setGeneral] = useState({ agency_name: "", support_email: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/general", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { agency_name?: string; support_email?: string }) => setGeneral({ agency_name: d.agency_name ?? "", support_email: d.support_email ?? "" }));
  }, []);

  const saveGeneral = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/settings/general", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(general),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? t("common.error"));
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <AdminShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings className="size-6 text-emerald-400" aria-hidden /> {t("admin.settings.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("admin.settings.subtitle")}</p>
        </div>

        <AiProvidersCard />

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4" aria-labelledby="agency-title">
          <h2 id="agency-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Shield className="size-4 text-emerald-400" aria-hidden /> {t("admin.settings.agencyTitle")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="agency-name" className={labelCls}>{t("admin.settings.agencyName")}</label>
              <input id="agency-name" value={general.agency_name} onChange={(e) => setGeneral((g) => ({ ...g, agency_name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label htmlFor="support-email" className={labelCls}>{t("admin.settings.supportEmail")}</label>
              <input id="support-email" type="email" value={general.support_email} onChange={(e) => setGeneral((g) => ({ ...g, support_email: e.target.value }))} className={inputCls} />
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          <button
            type="button"
            onClick={saveGeneral}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saved ? t("admin.settings.saved") : t("admin.settings.save")}
          </button>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-2" aria-labelledby="admins-title">
          <h2 id="admins-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="size-4 text-emerald-400" aria-hidden /> {t("admin.settings.adminsTitle")}
          </h2>
          <p className="text-xs text-slate-400">{t("admin.settings.adminsBody")}</p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 opacity-60" aria-labelledby="notif-title">
          <h2 id="notif-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Bell className="size-4 text-emerald-400" aria-hidden /> {t("admin.settings.notificationsTitle")}
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-400">{t("admin.settings.comingSoon")}</span>
          </h2>
        </section>
      </div>
    </AdminShell>
  );
}
