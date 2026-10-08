'use client'

import { useMemo, useState } from 'react'
import { Activity, CalendarDays, CalendarRange, List, Loader2, Plus, Search, Users } from 'lucide-react'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { getPreset } from '@/lib/industries'
import { addDays, safeTimeZone, zonedNow } from '@/lib/ai/time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { BookingCalendar } from './booking-calendar'
import { BookingDetailsDialog } from './booking-details-dialog'
import { BookingFormDialog } from './booking-form-dialog'
import { BookingList, type BookingRowHandlers } from './booking-list'
import { CustomerHistoryDialog } from './customer-history-dialog'
import { customFieldSummary } from './fields'
import { BOOKING_STATUSES, customerName, type Booking, type BookingStatus, type ContactLite } from './types'
import { useBookingActions } from './use-booking-actions'
import { useBookingsData } from './use-bookings-data'
import { pushGoogleSync } from '@/components/integrations/google/push'

type Scope = 'upcoming' | 'today' | 'past' | 'all'

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Activity; label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

export function BookingsManager() {
  const { t, locale } = useI18n()
  const { workspace, label, modules, loading: wsLoading } = useWorkspace()
  const preset = getPreset(workspace?.industry)
  const productFieldOn = preset.bookingFields.some((f) => f.type === 'product')
  const data = useBookingsData(workspace, productFieldOn)
  const actions = useBookingActions(data.patch)

  const today = zonedNow(safeTimeZone(workspace?.timezone)).date
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [scope, setScope] = useState<Scope>('upcoming')
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [staffFilter, setStaffFilter] = useState('')
  const [search, setSearch] = useState('')

  // Dialog state. `formKey` remounts the form so it starts fresh.
  const [form, setForm] = useState<{ open: boolean; booking: Booking | null; date: string; key: number }>({ open: false, booking: null, date: today, key: 0 })
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [customer, setCustomer] = useState<ContactLite | null>(null)
  const [deleting, setDeleting] = useState<Booking | null>(null)

  const details = detailsId ? data.bookings.find((b) => b.id === detailsId) ?? null : null
  const lower = (s: string) => s.toLocaleLowerCase(locale)

  const openCreate = (date = today) => setForm((f) => ({ open: true, booking: null, date: date < today ? today : date, key: f.key + 1 }))
  const openEdit = (b: Booking) => {
    setDetailsId(null)
    setForm((f) => ({ open: true, booking: b, date: b.booking_date, key: f.key + 1 }))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = data.bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (staffFilter && b.staff_id !== staffFilter) return false
      if (view === 'list') {
        if (scope === 'upcoming' && b.booking_date < today) return false
        if (scope === 'today' && b.booking_date !== today) return false
        if (scope === 'past' && b.booking_date >= today) return false
      }
      if (!q) return true
      return [customerName(b), b.contact?.phone, b.staff?.name, b.service?.name, b.notes, customFieldSummary(b, preset.bookingFields, locale)]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    })
    // Upcoming reads best soonest-first; history newest-first.
    if (view === 'list' && (scope === 'upcoming' || scope === 'today')) {
      list.sort((a, b) => (a.booking_date + a.booking_time).localeCompare(b.booking_date + b.booking_time))
    }
    return list
  }, [data.bookings, statusFilter, staffFilter, scope, search, view, today, preset.bookingFields, locale])

  const stats = useMemo(() => {
    const b = data.bookings
    const weekEnd = addDays(today, 7)
    const todayList = b.filter((x) => x.booking_date === today && x.status !== 'cancelled')
    const week = b.filter((x) => x.booking_date >= today && x.booking_date < weekEnd && (x.status === 'pending' || x.status === 'confirmed'))
    const lost = b.filter((x) => x.status === 'cancelled' || x.status === 'no_show').length
    return {
      today: todayList.length,
      todayPending: todayList.filter((x) => x.status === 'pending').length,
      week: week.length,
      customers: new Set(b.map((x) => x.contact_id)).size,
      cancelRate: b.length ? Math.round((lost / b.length) * 100) : 0,
    }
  }, [data.bookings, today])

  const remove = async () => {
    if (!deleting) return
    const { error } = await createClient().from('bookings').delete().eq('id', deleting.id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(t('bookings.toast.deleted'))
    pushGoogleSync()
    if (detailsId === deleting.id) setDetailsId(null)
    data.reload()
  }

  const handlers: BookingRowHandlers = {
    onOpen: (b) => setDetailsId(b.id),
    onEdit: openEdit,
    onDelete: (b) => setDeleting(b),
    onStatus: (b, s) => actions.changeStatus(b, s),
    onSend: actions.sendMessage,
    onCustomer: (b) => b.contact && setCustomer({ id: b.contact.id, name: b.contact.name, phone: b.contact.phone }),
    sending: actions.sending,
  }

  if (wsLoading || (data.loading && workspace)) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!modules.bookings) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <CalendarDays className="mx-auto mb-3 size-10 text-muted-foreground" />
        <h1 className="font-semibold text-foreground">{t('bookings.disabled.title', { bookings: lower(label('bookingPlural')) })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('bookings.disabled.hint')}</p>
      </div>
    )
  }

  const showStaffFilter = modules.staff && data.staff.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{label('bookingPlural')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bookings.subtitle', { bookings: lower(label('bookingPlural')), customers: lower(label('customerPlural')) })}
          </p>
        </div>
        <Button onClick={() => openCreate()}>
          <Plus className="size-4" />
          {t('bookings.actions.create', { booking: lower(label('booking')) })}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CalendarRange} label={t('bookings.stats.today')} value={stats.today} hint={t('bookings.stats.pending', { n: stats.todayPending })} />
        <Stat icon={CalendarDays} label={t('bookings.stats.week')} value={stats.week} />
        <Stat icon={Users} label={label('customerPlural')} value={stats.customers} />
        <Stat icon={Activity} label={t('bookings.stats.cancelRate')} value={`${stats.cancelRate}%`} hint={t('bookings.stats.cancelHint')} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('bookings.searchPlaceholder')}
              aria-label={t('bookings.searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <div className="flex w-fit gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5" role="tablist">
            {(['list', 'calendar'] as const).map((v) => {
              const Icon = v === 'list' ? List : CalendarDays
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold',
                    view === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {t(`bookings.view.${v}`)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === 'list' && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              aria-label={t('bookings.scope.label')}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground dark:bg-input/30"
            >
              {(['upcoming', 'today', 'past', 'all'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`bookings.scope.${s}`)}
                </option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BookingStatus | 'all')}
            aria-label={t('bookings.fields.status')}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground dark:bg-input/30"
          >
            <option value="all">{t('bookings.status.all')}</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`bookings.status.${s}`)}
              </option>
            ))}
          </select>
          {showStaffFilter && (
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              aria-label={label('staff')}
              className="h-8 max-w-[12rem] rounded-lg border border-input bg-transparent px-2 text-xs text-foreground dark:bg-input/30"
            >
              <option value="">{t('bookings.allStaff', { staff: lower(label('staffPlural')) })}</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <BookingList bookings={filtered} fields={preset.bookingFields} {...handlers} />
      ) : (
        <BookingCalendar bookings={filtered} today={today} onCreateOn={openCreate} {...handlers} />
      )}

      {form.open && (
        <BookingFormDialog
          key={form.key}
          open={form.open}
          onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
          booking={form.booking}
          initialDate={form.date}
          fields={preset.bookingFields}
          needsStaff={preset.bookingNeedsStaff}
          staff={data.staff}
          services={data.services}
          products={data.products}
          hours={data.hours}
          onSaved={(id, notify) => {
            data.reload()
            if (notify) actions.notifyStatus(id)
          }}
        />
      )}

      <BookingDetailsDialog
        booking={details}
        fields={preset.bookingFields}
        products={data.products}
        onClose={() => setDetailsId(null)}
        onEdit={openEdit}
        onDelete={(b) => setDeleting(b)}
        onStatus={(b, s) => actions.changeStatus(b, s)}
        onSend={actions.sendMessage}
        onCustomer={handlers.onCustomer}
        sending={actions.sending}
      />

      {customer && (
        <CustomerHistoryDialog
          key={customer.id}
          contact={customer}
          bookings={data.bookings}
          today={today}
          onClose={() => setCustomer(null)}
          onOpenBooking={(b) => {
            setCustomer(null)
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
    </div>
  )
}
