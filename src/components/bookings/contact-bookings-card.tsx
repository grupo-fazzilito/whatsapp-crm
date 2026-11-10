'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, History, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { getPreset } from '@/lib/industries'
import { safeTimeZone, zonedNow } from '@/lib/ai/time'
import type { BusinessHoursRow } from '@/lib/ai/slots'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'
import { useRealtimeChanges } from '@/lib/realtime/client'
import { api } from '@/components/business/api'
import { pushGoogleSync } from '@/components/integrations/google/push'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import type { StaffOption } from './availability'
import { BookingDetailsDialog } from './booking-details-dialog'
import { BookingFormDialog } from './booking-form-dialog'
import { CustomerHistoryDialog } from './customer-history-dialog'
import { StatusBadge } from './status-select'
import type { Booking, ContactLite, ProductLite, ServiceLite } from './types'
import { useBookingActions } from './use-booking-actions'

const MAX_UPCOMING = 5

interface Options {
  staff: StaffOption[]
  services: ServiceLite[]
  products: ProductLite[]
  hours: BusinessHoursRow[]
}

/**
 * The chat customer's bookings in the inbox side panel: upcoming ones
 * (open, change status, edit), the whole history, and "+ Nuevo" with the
 * Agenda's form — customer preselected, booking tied to this chat.
 * Renders nothing when the business has no bookings module.
 */
export function ContactBookingsCard({ contact, conversationId }: { contact: ContactLite; conversationId?: string | null }) {
  const { t, locale } = useI18n()
  const { workspace, label, modules } = useWorkspace()
  const preset = getPreset(workspace?.industry)
  const withProducts = preset.bookingFields.some((f) => f.type === 'product')
  const today = zonedNow(safeTimeZone(workspace?.timezone)).date
  const enabled = !!workspace && modules.bookings
  const contactId = contact.id

  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [form, setForm] = useState<{ open: boolean; booking: Booking | null; key: number }>({ open: false, booking: null, key: 0 })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleting, setDeleting] = useState<Booking | null>(null)

  const load = useCallback(async () => {
    const d = await api<{ bookings: Booking[] }>(`/api/bookings?contact_id=${contactId}`).catch(() => null)
    setBookings(d?.bookings ?? [])
  }, [contactId])

  useEffect(() => {
    if (!enabled) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookings(null)
    load()
  }, [enabled, load])

  // Staff, services, hours (and products) for the form: once, when first needed.
  const loadOptions = useCallback(async () => {
    if (options) return options
    const o = await api<Options>(`/api/bookings/options${withProducts ? '?products=1' : ''}`).catch((err: Error) => {
      toast.error(err.message)
      return null
    })
    if (o) setOptions(o)
    return o
  }, [options, withProducts])

  // Bookings the AI agent or a teammate makes for this customer show up live.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])
  useRealtimeChanges<{ id?: string; contact_id?: string | null }>({
    workspaceId: workspace?.id,
    enabled,
    tables: ['bookings'],
    onChange: (change) => {
      const cid = change.eventType === 'DELETE' ? change.old.contact_id : change.new.contact_id
      const id = change.new.id ?? change.old.id
      if (cid !== contactId && !(id && bookings?.some((b) => b.id === id))) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => loadRef.current(), 300)
    },
  })

  const patch = useCallback((id: string, changes: Partial<Booking>) => {
    setBookings((list) => list?.map((b) => (b.id === id ? { ...b, ...changes } : b)) ?? list)
  }, [])
  const actions = useBookingActions(patch)

  if (!enabled) return null

  const openForm = async (booking: Booking | null) => {
    if (!(await loadOptions())) return
    setDetailsId(null)
    setHistoryOpen(false)
    setForm((f) => ({ open: true, booking, key: f.key + 1 }))
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await api(`/api/bookings/${deleting.id}`, { method: 'DELETE' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return
    }
    toast.success(t('bookings.toast.deleted'))
    pushGoogleSync()
    if (detailsId === deleting.id) setDetailsId(null)
    load()
  }

  const upcoming = (bookings ?? [])
    .filter((b) => b.booking_date >= today && b.status !== 'cancelled')
    .sort((a, b) => (a.booking_date + a.booking_time).localeCompare(b.booking_date + b.booking_time))
  const shown = upcoming.slice(0, MAX_UPCOMING)
  const details = detailsId ? bookings?.find((b) => b.id === detailsId) ?? null : null
  const plural = label('bookingPlural')
  const lower = (s: string) => s.toLocaleLowerCase(locale)

  return (
    <section aria-labelledby={`bookings-${contactId}`} className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <h3 id={`bookings-${contactId}`} className="flex items-center gap-1.5">
          <CalendarDays aria-hidden className="size-3.5" />
          {plural}
          {upcoming.length > 0 && <span className="tabular-nums">({upcoming.length})</span>}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void openForm(null)}
          aria-label={t('bookings.actions.create', { booking: lower(label('booking')) })}
        >
          <Plus className="size-3" />
          {t('crm.panel.add')}
        </Button>
      </div>

      {bookings === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('crm.common.loading')} />
      ) : shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('inbox.bookings.noUpcoming', { bookings: lower(plural) })}</p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  void loadOptions()
                  setDetailsId(b.id)
                }}
                className="grid w-full gap-1 rounded-lg border border-border bg-card p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium capitalize">
                    {formatBookingDate(b.booking_date, locale)} · {formatBookingTime(b.booking_time, locale)}
                  </span>
                  <StatusBadge status={b.status} className="shrink-0" />
                </span>
                {(b.service || b.staff) && (
                  <span className="truncate text-xs text-muted-foreground">{[b.service?.name, b.staff?.name].filter(Boolean).join(' · ')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {bookings && bookings.length > 0 && (
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="inline-flex w-fit items-center gap-1 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History aria-hidden className="size-3" />
          {t('inbox.bookings.history', { count: bookings.length })}
        </button>
      )}

      {form.open && options && (
        <BookingFormDialog
          key={form.key}
          open={form.open}
          onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
          booking={form.booking}
          initialDate={today}
          initialContact={contact}
          conversationId={conversationId}
          fields={preset.bookingFields}
          needsStaff={preset.bookingNeedsStaff}
          staff={options.staff}
          services={options.services}
          products={options.products}
          hours={options.hours}
          onSaved={(id, notify) => {
            load()
            if (notify) actions.notifyStatus(id)
          }}
        />
      )}

      <BookingDetailsDialog
        booking={details}
        fields={preset.bookingFields}
        products={options?.products ?? []}
        onClose={() => setDetailsId(null)}
        onEdit={(b) => void openForm(b)}
        onDelete={(b) => setDeleting(b)}
        onStatus={(b, s) => actions.changeStatus(b, s)}
        onSend={actions.sendMessage}
        onCustomer={() => {
          setDetailsId(null)
          setHistoryOpen(true)
        }}
        sending={actions.sending}
      />

      {historyOpen && (
        <CustomerHistoryDialog
          contact={contact}
          bookings={bookings ?? []}
          today={today}
          onClose={() => setHistoryOpen(false)}
          onOpenBooking={(b) => {
            setHistoryOpen(false)
            setDetailsId(b.id)
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('bookings.delete.title', { booking: lower(label('booking')) })}
        description={t('bookings.delete.description')}
        confirmText={t('bookings.actions.delete')}
        cancelText={t('bookings.form.cancel')}
        onConfirm={remove}
        variant="destructive"
      />
    </section>
  )
}
