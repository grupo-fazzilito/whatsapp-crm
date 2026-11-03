"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Save, UserRound } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { authClient } from "@/lib/auth/client";
import { AdminShell } from "../admin-shell";

const MIN_PASSWORD = 8;
const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-60";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5";
const cardCls = "rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-4";
const buttonCls =
  "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors";

/** The signed-in platform admin's own name and password. */
export default function AdminProfilePage() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name: string; email: string } | null) => {
        if (cancelled || !d) return;
        setName(d.name);
        setEmail(d.email);
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    const res = await fetch("/api/admin/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setSavingName(false);
    if (res?.ok) {
      toast.success(t("admin.profile.saved"));
      window.dispatchEvent(new Event("admin-profile-updated"));
    } else toast.error(t("admin.profile.error"));
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) return setPasswordError(t("admin.profile.passwordShort", { n: MIN_PASSWORD }));
    if (next !== confirm) return setPasswordError(t("admin.profile.passwordMismatch"));
    setPasswordError(null);
    setSavingPassword(true);
    const { error } = await authClient
      .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
      .catch(() => ({ error: { status: 500 } as { status: number } }));
    setSavingPassword(false);
    if (error) {
      setPasswordError(error.status === 400 || error.status === 401 ? t("admin.profile.passwordWrong") : t("admin.profile.error"));
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success(t("admin.profile.passwordSaved"));
  };

  return (
    <AdminShell>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">{t("admin.profile.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("admin.profile.description")}</p>
        </div>

        <form onSubmit={saveName} className={cardCls} aria-labelledby="admin-profile-data">
          <h2 id="admin-profile-data" className="flex items-center gap-2 text-sm font-semibold text-white">
            <UserRound className="size-4 text-emerald-400" aria-hidden /> {t("admin.profile.data")}
          </h2>
          <div>
            <label htmlFor="admin-name" className={labelCls}>{t("admin.profile.name")}</label>
            <input id="admin-name" className={inputCls} required maxLength={200} value={name} disabled={!loaded} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="admin-email" className={labelCls}>{t("admin.profile.email")}</label>
            <input id="admin-email" className={inputCls} value={email} disabled readOnly />
            <p className="mt-1.5 text-xs text-slate-500">{t("admin.profile.emailHint")}</p>
          </div>
          <button type="submit" className={buttonCls} disabled={savingName || !loaded}>
            {savingName ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {t("admin.profile.save")}
          </button>
        </form>

        <form onSubmit={savePassword} className={cardCls} aria-labelledby="admin-profile-password">
          <h2 id="admin-profile-password" className="flex items-center gap-2 text-sm font-semibold text-white">
            <KeyRound className="size-4 text-emerald-400" aria-hidden /> {t("admin.profile.password")}
          </h2>
          <p className="text-xs text-slate-400">{t("admin.profile.passwordHint", { n: MIN_PASSWORD })}</p>
          <div>
            <label htmlFor="admin-pw-current" className={labelCls}>{t("admin.profile.currentPassword")}</label>
            <input id="admin-pw-current" type="password" className={inputCls} required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-pw-new" className={labelCls}>{t("admin.profile.newPassword")}</label>
              <input id="admin-pw-new" type="password" className={inputCls} required minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="admin-pw-confirm" className={labelCls}>{t("admin.profile.confirmPassword")}</label>
              <input id="admin-pw-confirm" type="password" className={inputCls} required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          {passwordError && <p role="alert" className="text-sm text-red-400">{passwordError}</p>}
          <button type="submit" className={buttonCls} disabled={savingPassword}>
            {savingPassword ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
            {t("admin.profile.changePassword")}
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
