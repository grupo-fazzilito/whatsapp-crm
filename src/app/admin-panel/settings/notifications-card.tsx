"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { ADMIN_NOTIFICATION_TYPES, type AdminNotificationType } from "@/lib/admin/notifications";

/** Admin settings → which platform events notify the admins. Saved on each toggle. */
export function AdminNotificationsCard() {
  const { t } = useI18n();
  const [disabled, setDisabled] = useState<AdminNotificationType[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/notifications/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { disabled: [] }))
      .then((d: { disabled: AdminNotificationType[] }) => setDisabled(d.disabled))
      .catch(() => setDisabled([]));
  }, []);

  async function toggle(type: AdminNotificationType, on: boolean) {
    const next = on ? (disabled ?? []).filter((x) => x !== type) : [...(disabled ?? []), type];
    setDisabled(next);
    const res = await fetch("/api/admin/notifications/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: next }),
    }).catch(() => null);
    setStatus(res?.ok ? t("admin.notify.saved") : t("common.error"));
    setTimeout(() => setStatus(null), 2000);
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4" aria-labelledby="notif-title">
      <div>
        <h2 id="notif-title" className="text-sm font-bold text-white flex items-center gap-2">
          <Bell className="size-4 text-emerald-400" aria-hidden /> {t("admin.notify.settingsTitle")}
        </h2>
        <p className="mt-1 text-xs text-slate-400">{t("admin.notify.settingsBody")}</p>
      </div>
      {disabled && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {ADMIN_NOTIFICATION_TYPES.map((type) => {
            const id = `notif-${type.replace(/\./g, "-")}`;
            return (
              <li key={type}>
                <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/50">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-emerald-500"
                    checked={!disabled.includes(type)}
                    onChange={(e) => void toggle(type, e.target.checked)}
                  />
                  {t(`admin.notify.types.${type.replace(/\./g, "_")}.label`)}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" className="min-h-4 text-xs text-emerald-400">{status ?? ""}</p>
    </section>
  );
}
