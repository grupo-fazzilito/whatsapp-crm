'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck, Loader2 } from 'lucide-react';
import type { StorePaymentMethod } from '@/lib/store/server';
import type { StoreService, StoreServiceField } from '@/lib/store/services';
import { fill } from '@/lib/store/texts';
import { useStore } from '../../cart';

interface Props {
  service: StoreService;
  preview: boolean;
  dialCode: string;
  payments: StorePaymentMethod[];
  /** Industry booking data (age, party size…). */
  fields: StoreServiceField[];
}

const field = 'h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500';
const label = 'mb-1.5 block text-sm font-medium text-slate-800';

/** Pick staff, day and time (when the service books at checkout), then the customer's details and payment. */
export function ServiceBooking({ service, preview, dialCode, payments, fields }: Props) {
  const { t, config, money } = useStore();
  const router = useRouter();
  const schedule = service.booking === 'schedule';
  const [staffId, setStaffId] = useState<string>('');
  const [days, setDays] = useState<{ date: string; open: boolean }[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [times, setTimes] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const base = `/api/public/store/${encodeURIComponent(config.slug)}`;
  const needsPayment = service.price > 0;

  const dayFmt = new Intl.DateTimeFormat(config.locale === 'en' ? 'en-US' : 'es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat(config.locale === 'en' ? 'en-US' : 'es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const asDate = (d: string) => new Date(`${d}T12:00:00Z`);

  // Days with free times (for this staff member, or anyone).
  useEffect(() => {
    if (!schedule) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new staff choice starts over
    setDays(null);
    setDate(null);
    setTime(null);
    fetch(`${base}/services/${service.id}/slots${staffId ? `?staff=${staffId}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { days: [] }))
      .then((d: { days: { date: string; open: boolean }[] }) => {
        if (cancelled) return;
        setDays(d.days);
        setDate(d.days.find((x) => x.open)?.date ?? null);
      })
      .catch(() => !cancelled && setDays([]));
    return () => {
      cancelled = true;
    };
  }, [schedule, staffId, base, service.id]);

  // Times of the chosen day.
  useEffect(() => {
    if (!schedule || !date) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new day starts over
    setTimes(null);
    setTime(null);
    fetch(`${base}/services/${service.id}/slots?date=${date}${staffId ? `&staff=${staffId}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { times: [] }))
      .then((d: { times: string[] }) => !cancelled && setTimes(d.times))
      .catch(() => !cancelled && setTimes([]));
    return () => {
      cancelled = true;
    };
  }, [schedule, date, staffId, base, service.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`${base}/service-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: service.id,
        staff_id: staffId || null,
        date,
        time,
        customer: { name, phone, email },
        payment_method_id: needsPayment ? paymentId : null,
        fields: Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' && values[f.key] ? Number(values[f.key]) : values[f.key] ?? ''])),
        notes,
        website,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: string; alternatives?: string[] };
    if (res?.status === 201 && body.url) {
      router.push(body.url);
      return;
    }
    setSending(false);
    const code = res?.status === 429 ? 'rate' : (body.error ?? 'failed');
    setError(t.serviceErrors[code] ?? (t.errors as Record<string, string>)[code] ?? t.errors.failed);
    // Someone took the time: show the day's times again.
    if (code === 'slot_taken' && date) {
      setTime(null);
      setTimes(null);
      fetch(`${base}/services/${service.id}/slots?date=${date}${staffId ? `&staff=${staffId}` : ''}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: { times: string[] }) => setTimes(d.times ?? []))
        .catch(() => setTimes([]));
    }
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`;
  const chipStyle = (active: boolean) => (active ? { background: config.accent, borderColor: config.accent } : undefined);
  const ready = (!schedule || (date && time)) && (!needsPayment || paymentId);

  return (
    <form onSubmit={submit} noValidate className="min-w-0 space-y-5 rounded-3xl bg-white p-5 ring-1 ring-slate-200 lg:sticky lg:top-24">
      {preview && <p role="status" className="rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">{t.previewNoOrders}</p>}

      {schedule ? (
        <>
          {service.staff.length > 1 && (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-semibold">{t.withWhom}</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={!staffId} onClick={() => setStaffId('')} className={chip(!staffId)} style={chipStyle(!staffId)}>{t.anyone}</button>
                {service.staff.map((p) => (
                  <button key={p.id} type="button" aria-pressed={staffId === p.id} onClick={() => setStaffId(p.id)} className={chip(staffId === p.id)} style={chipStyle(staffId === p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-semibold">{t.pickDay}</legend>
            {!days ? (
              <Loader2 className="size-5 animate-spin text-slate-400" aria-label="…" />
            ) : !days.some((d) => d.open) ? (
              <p className="text-sm text-slate-600">{t.noDays}</p>
            ) : (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {days.map((d) => (
                  <button key={d.date} type="button" disabled={!d.open} aria-pressed={date === d.date} onClick={() => setDate(d.date)} className={`${chip(date === d.date)} shrink-0`} style={chipStyle(date === d.date)}>
                    {dayFmt.format(asDate(d.date))}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {date && (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-semibold">
                {t.pickTime} · <span className="font-normal text-slate-600">{longFmt.format(asDate(date))}</span>
              </legend>
              {!times ? (
                <Loader2 className="size-5 animate-spin text-slate-400" aria-label="…" />
              ) : times.length === 0 ? (
                <p className="text-sm text-slate-600">{t.noTimes}</p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {times.map((x) => (
                    <button key={x} type="button" aria-pressed={time === x} onClick={() => setTime(x)} className={`${chip(time === x)} px-0 tabular-nums`} style={chipStyle(time === x)}>
                      {x}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
        </>
      ) : (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{t.laterNote}</p>
      )}

      <fieldset className="min-w-0 space-y-4 border-t border-slate-100 pt-4">
        <legend className="mb-2 text-sm font-semibold">{t.contact}</legend>
        <div>
          <label htmlFor="sv-name" className={label}>{t.name}</label>
          <input id="sv-name" className={field} required autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error === t.errors.name || undefined} />
        </div>
        <div>
          <label htmlFor="sv-phone" className={label}>{t.phone}</label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">+{dialCode.replace(/\D/g, '')}</span>
            <input id="sv-phone" className={`${field} rounded-l-none`} required type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="sv-email" className={label}>{t.email}</label>
          <input id="sv-email" className={field} type="email" autoComplete="email" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {schedule &&
          fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={`sv-f-${f.key}`} className={label}>{f.label}{f.required ? '' : ` (${config.locale === 'en' ? 'optional' : 'opcional'})`}</label>
              <input
                id={`sv-f-${f.key}`}
                className={field}
                required={f.required}
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                maxLength={200}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: f.type === 'number' ? e.target.value.replace(/[^\d]/g, '') : e.target.value })}
              />
            </div>
          ))}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden />
      </fieldset>

      {needsPayment && (
        <fieldset className="min-w-0 space-y-2 border-t border-slate-100 pt-4">
          <legend className="mb-2 text-sm font-semibold">{t.payment}</legend>
          {payments.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 hover:bg-slate-50" style={paymentId === p.id ? { borderColor: config.accent, boxShadow: `inset 0 0 0 1px ${config.accent}` } : { borderColor: '#e2e8f0' }}>
              <input type="radio" name="sv-pay" checked={paymentId === p.id} onChange={() => setPaymentId(p.id)} className="size-4" style={{ accentColor: config.accent }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{p.name}</span>
                {p.instructions && <span className="block text-xs text-slate-500">{p.instructions}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div>
        <label htmlFor="sv-notes" className={label}>{t.notes}</label>
        <textarea id="sv-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} h-auto py-2.5`} />
      </div>

      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 focus:outline-none">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={preview || sending || !ready}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: config.accent }}
      >
        {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarCheck className="size-4" aria-hidden />}
        {sending
          ? t.placing
          : `${schedule ? t.confirmBooking : t.confirmService}${needsPayment ? ` · ${money(service.price)}` : ''}${schedule && date && time ? ` · ${fill(t.bookingAt, { date: dayFmt.format(asDate(date)), time })}` : ''}`}
      </button>
    </form>
  );
}
