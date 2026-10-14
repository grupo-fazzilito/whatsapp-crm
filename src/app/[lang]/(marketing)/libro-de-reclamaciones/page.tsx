"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, CheckCircle2, Loader2, Printer } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { COMPANY, companyAddress } from "@/lib/company";
import { COMPLAINT_KINDS, DOC_TYPES, ITEM_TYPES, type ComplaintErrors } from "@/lib/complaints/input";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full h-10 rounded-lg border border-[var(--m-input-border)] bg-[var(--m-input-bg)] px-3 text-xs text-[var(--m-text-primary)] focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 aria-[invalid=true]:border-red-500";
const AREA = INPUT.replace("h-10", "min-h-24 py-2.5 resize-y");

type Form = {
  kind: string; consumer_name: string; doc_type: string; doc_number: string; address: string; phone: string; email: string;
  is_minor: boolean; guardian_name: string; item_type: string; item_description: string; amount: string; detail: string; request: string;
  accepted: boolean; website: string;
};
const EMPTY: Form = {
  kind: "reclamo", consumer_name: "", doc_type: "dni", doc_number: "", address: "", phone: "", email: "", is_minor: false, guardian_name: "",
  item_type: "servicio", item_description: "", amount: "", detail: "", request: "", accepted: false, website: "",
};

export default function ComplaintsBookPage() {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<ComplaintErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; created_at: string; due_date: string; email: string } | null>(null);
  const today = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PE", { dateStyle: "long", timeZone: "America/Lima" });
  const day = (ymd: string) => today.format(new Date(`${ymd}T12:00:00-05:00`));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: keyof ComplaintErrors) => (errors[k] ? t(`complaints.errors.${errors[k]}`) : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    const r = await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, locale }),
    }).catch(() => null);
    setBusy(false);
    const body = r ? await r.json().catch(() => null) : null;
    if (r?.status === 201) {
      setDone(body.complaint);
      setForm(EMPTY);
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (r?.status === 422 && body?.fields) {
      setErrors(body.fields);
      const first = Object.keys(body.fields)[0];
      document.getElementById(`cb-${first}`)?.focus();
    } else {
      setFailure(r?.status === 429 ? t("complaints.errors.rate") : t("complaints.errors.generic", { email: COMPANY.email }));
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 md:px-6 py-20 space-y-8">
      <style>{`@media print { nav, header, footer, .cb-no-print { display: none !important; } body { background: #fff !important; } }`}</style>
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <BookOpen className="size-3" aria-hidden /> {t("complaints.subtitle")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">{t("complaints.title")}</h1>
        <p className="text-sm text-[var(--m-text-tertiary)]">{t("complaints.notice")}</p>
      </div>

      <section aria-labelledby="cb-provider" className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/20 p-5 text-xs text-[var(--m-text-tertiary)] space-y-1">
        <h2 id="cb-provider" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text-muted)] mb-2">{t("complaints.sheet.provider")}</h2>
        <p className="font-bold text-[var(--m-text-primary)]">{COMPANY.legalName}</p>
        <p>{COMPANY.taxIdLabel} {COMPANY.taxId}</p>
        <p>{companyAddress(locale)}</p>
        <p>{COMPANY.email}</p>
        <p className="pt-2">{t("complaints.sheet.date")}: {today.format(new Date())}</p>
      </section>

      {done ? (
        <section role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--m-text-heading)]">
            <CheckCircle2 className="size-5 text-emerald-400" aria-hidden /> {t("complaints.success.title")}
          </h2>
          <p className="text-sm text-[var(--m-text-secondary)]">{t("complaints.success.body", { code: done.code, email: done.email })}</p>
          <p className="text-sm text-[var(--m-text-secondary)]">{t("complaints.success.due", { date: day(done.due_date) })}</p>
          <div className="cb-no-print flex flex-wrap gap-3 pt-2">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--m-border-primary)] px-4 py-2 text-xs font-bold text-[var(--m-text-secondary)] hover:bg-[var(--m-bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
              <Printer className="size-4" aria-hidden /> {t("complaints.success.print")}
            </button>
            <button type="button" onClick={() => setDone(null)} className="rounded-xl px-4 py-2 text-xs font-bold text-emerald-500 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
              {t("complaints.success.another")}
            </button>
          </div>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-8">
          <Fieldset legend={t("complaints.sheet.consumer")}>
            <Field id="consumer_name" label={t("complaints.fields.consumer_name")} error={err("consumer_name")} wide>
              <input id="cb-consumer_name" autoComplete="name" value={form.consumer_name} onChange={(e) => set("consumer_name", e.target.value)} aria-invalid={!!errors.consumer_name} aria-describedby={errors.consumer_name ? "cb-consumer_name-err" : undefined} className={INPUT} />
            </Field>
            <Field id="doc_type" label={t("complaints.fields.doc_type")} error={err("doc_type")}>
              <select id="cb-doc_type" value={form.doc_type} onChange={(e) => set("doc_type", e.target.value)} className={INPUT}>
                {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`complaints.docTypes.${d}`)}</option>)}
              </select>
            </Field>
            <Field id="doc_number" label={t("complaints.fields.doc_number")} error={err("doc_number")}>
              <input id="cb-doc_number" inputMode={form.doc_type === "dni" || form.doc_type === "ruc" ? "numeric" : "text"} value={form.doc_number} onChange={(e) => set("doc_number", e.target.value)} aria-invalid={!!errors.doc_number} aria-describedby={errors.doc_number ? "cb-doc_number-err" : undefined} className={INPUT} />
            </Field>
            <Field id="address" label={t("complaints.fields.address")} error={err("address")} wide>
              <input id="cb-address" autoComplete="street-address" value={form.address} onChange={(e) => set("address", e.target.value)} aria-invalid={!!errors.address} aria-describedby={errors.address ? "cb-address-err" : undefined} className={INPUT} />
            </Field>
            <Field id="email" label={t("complaints.fields.email")} error={err("email")}>
              <input id="cb-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? "cb-email-err" : undefined} className={INPUT} />
            </Field>
            <Field id="phone" label={t("complaints.fields.phone")} error={err("phone")}>
              <input id="cb-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "cb-phone-err" : undefined} className={INPUT} />
            </Field>
            <label className="sm:col-span-2 flex items-center gap-2 text-xs text-[var(--m-text-secondary)]">
              <input type="checkbox" checked={form.is_minor} onChange={(e) => set("is_minor", e.target.checked)} className="size-4 accent-emerald-500" />
              {t("complaints.fields.is_minor")}
            </label>
            {form.is_minor && (
              <Field id="guardian_name" label={t("complaints.fields.guardian_name")} error={err("guardian_name")} wide>
                <input id="cb-guardian_name" value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} aria-invalid={!!errors.guardian_name} aria-describedby={errors.guardian_name ? "cb-guardian_name-err" : undefined} className={INPUT} />
              </Field>
            )}
          </Fieldset>

          <Fieldset legend={t("complaints.sheet.item")}>
            <fieldset className="sm:col-span-2 flex flex-wrap gap-4">
              <legend className="sr-only">{t("complaints.fields.item_type")}</legend>
              {ITEM_TYPES.map((it) => (
                <label key={it} className="flex items-center gap-2 text-xs text-[var(--m-text-secondary)]">
                  <input type="radio" name="item_type" value={it} checked={form.item_type === it} onChange={() => set("item_type", it)} className="size-4 accent-emerald-500" />
                  {t(`complaints.itemTypes.${it}`)}
                </label>
              ))}
            </fieldset>
            <Field id="item_description" label={t("complaints.fields.item_description")} error={err("item_description")} wide>
              <input id="cb-item_description" placeholder={t("complaints.placeholders.item_description")} value={form.item_description} onChange={(e) => set("item_description", e.target.value)} aria-invalid={!!errors.item_description} aria-describedby={errors.item_description ? "cb-item_description-err" : undefined} className={INPUT} />
            </Field>
            <Field id="amount" label={t("complaints.fields.amount")} error={err("amount")}>
              <input id="cb-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? "cb-amount-err" : undefined} className={INPUT} />
            </Field>
          </Fieldset>

          <Fieldset legend={t("complaints.sheet.detail")}>
            <fieldset className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t("complaints.fields.kind")}</legend>
              {COMPLAINT_KINDS.map((k) => (
                <label key={k} className={cn("flex gap-3 rounded-xl border p-3 text-xs cursor-pointer", form.kind === k ? "border-emerald-500 bg-emerald-500/5" : "border-[var(--m-border-primary)]")}>
                  <input type="radio" name="kind" value={k} checked={form.kind === k} onChange={() => set("kind", k)} className="mt-0.5 size-4 accent-emerald-500" />
                  <span>
                    <span className="block font-bold text-[var(--m-text-primary)]">{t(`complaints.kinds.${k}`)}</span>
                    <span className="text-[var(--m-text-tertiary)]">{t(`complaints.kindHelp.${k}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field id="detail" label={t("complaints.fields.detail")} error={err("detail")} wide>
              <textarea id="cb-detail" rows={5} maxLength={3000} placeholder={t("complaints.placeholders.detail")} value={form.detail} onChange={(e) => set("detail", e.target.value)} aria-invalid={!!errors.detail} aria-describedby={errors.detail ? "cb-detail-err" : undefined} className={AREA} />
            </Field>
            <Field id="request" label={t("complaints.fields.request")} error={err("request")} wide>
              <textarea id="cb-request" rows={3} maxLength={2000} placeholder={t("complaints.placeholders.request")} value={form.request} onChange={(e) => set("request", e.target.value)} aria-invalid={!!errors.request} aria-describedby={errors.request ? "cb-request-err" : undefined} className={AREA} />
            </Field>
          </Fieldset>

          {/* Honeypot: hidden from people, filled by bots. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} /></label>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-xs text-[var(--m-text-secondary)]">
              <input id="cb-accepted" type="checkbox" checked={form.accepted} onChange={(e) => set("accepted", e.target.checked)} aria-invalid={!!errors.accepted} aria-describedby={errors.accepted ? "cb-accepted-err" : undefined} className="mt-0.5 size-4 shrink-0 accent-emerald-500" />
              {t("complaints.fields.accepted")}
            </label>
            {errors.accepted && <p id="cb-accepted-err" className="text-xs text-red-500">{err("accepted")}</p>}
          </div>

          <div className="space-y-1 text-[11px] text-[var(--m-text-muted)] leading-relaxed">
            <p>{t("complaints.legal.deadline")}</p>
            <p>{t("complaints.legal.otherWays")}</p>
          </div>

          {failure && <p role="alert" className="text-sm text-red-500">{failure}</p>}

          <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? t("complaints.sending") : t("complaints.submit")}
          </button>
        </form>
      )}
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-bold text-[var(--m-text-heading)] mb-4">{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({ id, label, error, wide, children }: { id: string; label: string; error: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
      <label htmlFor={`cb-${id}`} className="text-xs font-bold text-[var(--m-text-tertiary)]">{label}</label>
      {children}
      {error && <p id={`cb-${id}-err`} className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
