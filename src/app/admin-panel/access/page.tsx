"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { AdminShell } from "../admin-shell";

interface Row {
  id: string;
  admin_email: string;
  target_email: string;
  workspace_name: string | null;
  ip_address: string | null;
  started_at: string;
  ended_at: string | null;
}

/** Internal record of admins opening customer accounts ("Entrar como cliente"). */
export default function AdminAccessLogPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/impersonations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { impersonations: [] }))
      .catch(() => ({ impersonations: [] }))
      .then((d: { impersonations: Row[] }) => !cancelled && setRows(d.impersonations));
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-US" : "es-PE", { dateStyle: "medium", timeStyle: "short" });

  return (
    <AdminShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-white">{t("admin.impersonation.log")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("admin.impersonation.logDescription")}</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t("admin.impersonation.started")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("admin.impersonation.admin")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("admin.impersonation.account")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("admin.impersonation.business")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("admin.impersonation.ended")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    {t("admin.impersonation.none")}
                  </td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id} className="text-slate-200">
                  <td className="whitespace-nowrap px-4 py-2.5">{fmt(r.started_at)}</td>
                  <td className="px-4 py-2.5">{r.admin_email}</td>
                  <td className="px-4 py-2.5">{r.target_email}</td>
                  <td className="px-4 py-2.5">{r.workspace_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {r.ended_at ? fmt(r.ended_at) : <span className="text-amber-400">{t("admin.impersonation.active")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
