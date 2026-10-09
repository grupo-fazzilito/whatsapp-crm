'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { api } from '@/components/business/api'
import type { BookingField } from '@/lib/industries'
import { safeTimeZone, zonedNow } from '@/lib/ai/time'
import type { BusinessHoursRow } from '@/lib/ai/slots'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { eligibleStaff, useAvailability, type StaffOption } from './availability'
import { ContactPicker } from './contact-picker'
import { customFieldDefs } from './fields'
import { StatusSelect } from './status-select'
import type { Booking, BookingStatus, ContactLite, ProductLite, ServiceLite } from './types'
import { pushGoogleSync } from '@/components/integrations/google/push'

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

interface FormState {
  contact: ContactLite | null
  customer_name: string
  service_id: string
  staff_id: string
  product_id: string
  date: string
  time: string
  duration: string
  party_size: string
  custom: Record<string, string>
  notes: string
  status: BookingStatus
  notify: boolean
}

function initialState(booking: Booking | null, date: string): FormState {
  if (!booking) {
    return {
      contact: null,
      customer_name: '',
      service_id: '',
      staff_id: '',
      product_id: '',
      date,
      time: '',
      duration: '30',
      party_size: '',
      custom: {},
      notes: '',
      status: 'confirmed',
      notify: true,
    }
  }
  const custom: Record<string, string> = {}
  for (const [k, v] of Object.entries(booking.custom_fields ?? {})) {
    if (v !== null && typeof v !== 'object') custom[k] = String(v)
  }
  return {
    contact: booking.contact ? { id: booking.contact.id, name: booking.contact.name, phone: booking.contact.phone } : null,
    customer_name: booking.customer_name ?? '',
    service_id: booking.service_id ?? '',
    staff_id: booking.staff_id ?? '',
    product_id: booking.product_id ?? '',
    date: booking.booking_date,
    time: booking.booking_time,
    duration: String(booking.duration_minutes ?? 30),
    party_size: booking.party_size ? String(booking.party_size) : '',
    custom,
    notes: booking.notes ?? '',
    status: booking.status,
    notify: true,
  }
}

export interface BookingFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = new booking */
  booking: Booking | null
  initialDate: string
  fields: BookingField[]
  needsStaff: boolean
  staff: StaffOption[]
  services: ServiceLite[]
  products: ProductLite[]
  hours: BusinessHoursRow[]
  /** Called after a successful save; `notify` = tell the customer. */
  onSaved: (id: string, notify: boolean) => void
}

/** Create / edit dialog. Mount it with a `key` so it resets per booking. */
export function BookingFormDialog(props: BookingFormProps) {
  const { open, onOpenChange, booking, fields, staff, services, products, hours } = props
  const { t, locale } = useI18n()
  const { workspace, label, modules } = useWorkspace()
  const [form, setForm] = useState<FormState>(() => initialState(booking, props.initialDate))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const showServices = modules.services && services.length > 0
  const showStaff = modules.staff && staff.length > 0
  const staffRequired = props.needsStaff && showStaff
  const nameField = fields.find((f) => f.key === 'customer_name')
  const partyField = fields.find((f) => f.key === 'party_size')
  const productField = fields.find((f) => f.key === 'product_id' || f.type === 'product')
  const customDefs = customFieldDefs(fields)
  const lower = (s: string) => s.toLocaleLowerCase(locale)

  const staffChoices = useMemo(
    () => eligibleStaff(staff, form.service_id || null),
    [staff, form.service_id],
  )

  // Availability only matters when the slot is new or changed.
  const original = booking ? { date: booking.booking_date, time: booking.booking_time, staff: booking.staff_id ?? '', duration: String(booking.duration_minutes ?? 30) } : null
  const slotChanged =
    !original || original.date !== form.date || original.time !== form.time || original.staff !== form.staff_id || original.duration !== form.duration
  const active = form.status === 'pending' || form.status === 'confirmed'

  const availability = useAvailability(
    workspace && open
      ? {
          workspace,
          hours,
          staff: showStaff ? staff : [],
          date: form.date,
          durationMinutes: Number(form.duration) || 30,
          staffId: form.staff_id || null,
          serviceId: form.service_id || null,
          needsStaff: staffRequired,
          excludeId: booking?.id ?? null,
        }
      : null,
  )

  const now = zonedNow(safeTimeZone(workspace?.timezone))
  const isPast = !!form.date && !!form.time && (form.date < now.date || (form.date === now.date && form.time <= now.time))
  const conflict: 'past' | 'closed' | 'taken' | null =
    !slotChanged || !active || !form.date || !form.time || availability.loading
      ? null
      : isPast
        ? 'past'
        : availability.closed
          ? 'closed'
          : !availability.slots.includes(form.time)
            ? 'taken'
            : null

  const pickService = (id: string) => {
    const svc = services.find((s) => s.id === id)
    setForm((f) => ({
      ...f,
      service_id: id,
      duration: svc?.duration_minutes ? String(svc.duration_minutes) : f.duration,
      // Drop a staff member who doesn't perform the new service.
      staff_id: f.staff_id && !eligibleStaff(staff, id || null).some((s) => s.id === f.staff_id) ? '' : f.staff_id,
    }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspace) return
    if (!form.contact) return toast.error(t('bookings.form.errors.customer', { customer: lower(label('customer')) }))
    if (!form.date || !form.time) return toast.error(t('bookings.form.errors.when'))
    if (staffRequired && !form.staff_id) return toast.error(t('bookings.form.errors.staff', { staff: lower(label('staff')) }))
    if (partyField?.required && !(Number(form.party_size) > 0)) return toast.error(t('bookings.form.errors.required', { field: partyField.label[locale] }))
    if (productField?.required && products.length > 0 && !form.product_id) {
      return toast.error(t('bookings.form.errors.required', { field: productField.label[locale] }))
    }
    for (const f of customDefs) {
      if (f.required && !form.custom[f.key]?.trim()) return toast.error(t('bookings.form.errors.required', { field: f.label[locale] }))
    }

    const custom_fields: Record<string, unknown> = { ...(booking?.custom_fields ?? {}) }
    for (const [k, v] of Object.entries(form.custom)) {
      const def = customDefs.find((f) => f.key === k)
      const trimmed = v.trim()
      if (!trimmed) delete custom_fields[k]
      else custom_fields[k] = def?.type === 'number' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : trimmed
    }

    const payload = {
      contact_id: form.contact.id,
      customer_name: form.customer_name.trim() || form.contact.name || null,
      service_id: form.service_id || null,
      staff_id: form.staff_id || null,
      product_id: form.product_id || null,
      booking_date: form.date,
      booking_time: form.time.slice(0, 5),
      duration_minutes: Math.max(5, Number(form.duration) || 30),
      party_size: Number(form.party_size) > 0 ? Number(form.party_size) : null,
      custom_fields,
      notes: form.notes.trim() || null,
      status: form.status,
    }

    setSaving(true)
    const whenChanged = !!booking && (booking.booking_date !== payload.booking_date || booking.booking_time !== payload.booking_time)
    let savedId: string
    try {
      // The server resets the reminder flags when the date/time changes.
      const res = booking
        ? await api<{ id: string }>(`/api/bookings/${booking.id}`, { method: 'PATCH', body: payload })
        : await api<{ id: string }>('/api/bookings', { method: 'POST', body: payload })
      savedId = res.id
    } catch (err) {
      setSaving(false)
      toast.error(err instanceof Error ? err.message : String(err))
      return
    }
    setSaving(false)
    toast.success(booking ? t('bookings.toast.updated') : t('bookings.toast.created'))
    pushGoogleSync(savedId)
    const meaningful = !booking || whenChanged || booking.status !== form.status
    props.onSaved(savedId, form.notify && meaningful)
    onOpenChange(false)
  }

  const title = booking ? t('bookings.form.editTitle', { booking: lower(label('booking')) }) : t('bookings.form.createTitle', { booking: lower(label('booking')) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-3xl">
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('bookings.form.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
            {/* Who */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="bk-contact">{label('customer')} *</Label>
                <ContactPicker
                  id="bk-contact"
                  value={form.contact}
                  onChange={(c) =>
                    setForm((f) => ({
                      ...f,
                      contact: c,
                      customer_name: c && (!f.customer_name || f.customer_name === f.contact?.name) ? c.name ?? '' : f.customer_name,
                    }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bk-name">{nameField?.label[locale] ?? t('bookings.form.customerName')}</Label>
                <Input
                  id="bk-name"
                  value={form.customer_name}
                  onChange={(e) => set('customer_name', e.target.value)}
                  placeholder={t('bookings.form.customerNameHint')}
                />
              </div>

              {showServices && (
                <div className="space-y-1.5">
                  <Label htmlFor="bk-service">{label('service')}</Label>
                  <select id="bk-service" className={selectClass} value={form.service_id} onChange={(e) => pickService(e.target.value)}>
                    <option value="">{t('bookings.form.none')}</option>
                    {services
                      .filter((s) => s.is_active || s.id === form.service_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.duration_minutes ? ` · ${t('bookings.minutes', { n: s.duration_minutes })}` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {showStaff && (
                <div className="space-y-1.5">
                  <Label htmlFor="bk-staff">
                    {label('staff')}
                    {staffRequired ? ' *' : ''}
                  </Label>
                  <select id="bk-staff" className={selectClass} value={form.staff_id} onChange={(e) => set('staff_id', e.target.value)}>
                    <option value="">{staffRequired ? t('bookings.form.choose') : t('bookings.form.anyStaff')}</option>
                    {staffChoices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.title ? ` (${s.title})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {productField && products.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="bk-product">
                    {productField.label[locale]}
                    {productField.required ? ' *' : ''}
                  </Label>
                  <select id="bk-product" className={selectClass} value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
                    <option value="">{t('bookings.form.choose')}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {partyField && (
                <div className="space-y-1.5">
                  <Label htmlFor="bk-party">
                    {partyField.label[locale]}
                    {partyField.required ? ' *' : ''}
                  </Label>
                  <Input id="bk-party" type="number" min={1} value={form.party_size} onChange={(e) => set('party_size', e.target.value)} />
                </div>
              )}

              {customDefs.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`bk-f-${f.key}`}>
                    {f.label[locale]}
                    {f.required ? ' *' : ''}
                  </Label>
                  <Input
                    id={`bk-f-${f.key}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={form.custom[f.key] ?? ''}
                    onChange={(e) => setForm((s) => ({ ...s, custom: { ...s.custom, [f.key]: e.target.value } }))}
                  />
                </div>
              ))}
            </div>

            {/* When */}
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bk-date">{t('bookings.form.date')} *</Label>
                  <Input id="bk-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-time">{t('bookings.form.time')} *</Label>
                  <Input id="bk-time" type="time" step={300} value={form.time} onChange={(e) => set('time', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-duration">{t('bookings.form.duration')}</Label>
                  <Input id="bk-duration" type="number" min={5} step={5} value={form.duration} onChange={(e) => set('duration', e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>{t('bookings.form.availability')}</span>
                  {availability.loading && <Loader2 className="size-3.5 animate-spin" />}
                </div>
                {!form.date ? (
                  <p className="text-xs text-muted-foreground">{t('bookings.form.pickDate')}</p>
                ) : availability.closed ? (
                  <p className="text-xs text-muted-foreground">{t('bookings.form.closedDay')}</p>
                ) : staffRequired && !form.staff_id && availability.slots.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{t('bookings.form.anyStaffSlots', { staff: lower(label('staff')) })}</p>
                ) : null}
                {form.date && !availability.closed && !availability.loading && availability.slots.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('bookings.form.noSlots')}</p>
                )}
                {availability.slots.length > 0 && (
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                    {availability.slots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => set('time', s)}
                        className={cn(
                          'rounded-md border px-2 py-1 text-xs tabular-nums transition-colors',
                          form.time === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {conflict && (
                <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="size-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{t(`bookings.form.conflict.${conflict}`)}</p>
                    <p className="mt-0.5">{t('bookings.form.conflict.override')}</p>
                  </div>
                </div>
              )}

              {booking && (
                <div className="flex items-center justify-between gap-2">
                  <Label>{t('bookings.fields.status')}</Label>
                  <StatusSelect value={form.status} onChange={(s) => set('status', s)} />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="bk-notes">{t('bookings.form.notes')}</Label>
                <Textarea id="bk-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </div>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <span>
                  <span className="font-medium text-foreground">{t('bookings.form.notify')}</span>
                  <span className="block text-xs text-muted-foreground">{t('bookings.form.notifyHint')}</span>
                </span>
                <Switch checked={form.notify} onCheckedChange={(v) => set('notify', !!v)} />
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('bookings.form.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className={conflict ? 'bg-amber-600 text-white hover:bg-amber-600/90' : undefined}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {conflict ? t('bookings.form.saveAnyway') : t('bookings.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
