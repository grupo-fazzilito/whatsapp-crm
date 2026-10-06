'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'
import { addDays } from '@/lib/ai/time'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BookingRowHandlers } from './booking-list'
import { MessageButtons } from './message-buttons'
import { StatusSelect } from './status-select'
import { STATUS_STYLE, customerName, type Booking } from './types'

const INTL = { es: 'es-MX', en: 'en-US' } as const

const firstUpper = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const startDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells = Math.ceil((startDow + daysInMonth) / 7) * 7
  return Array.from({ length: cells }, (_, i) => {
    const date = addDays(first, i - startDow)
    return { date, inMonth: i >= startDow && i < startDow + daysInMonth }
  })
}

export function BookingCalendar({
  bookings,
  today,
  onCreateOn,
  ...h
}: {
  bookings: Booking[]
  /** Business-local today. */
  today: string
  onCreateOn: (date: string) => void
} & BookingRowHandlers) {
  const { t, locale } = useI18n()
  const { label } = useWorkspace()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1)
  const [selected, setSelected] = useState(today)

  const byDate = useMemo(() => {
    const map = new Map<string, Booking[]>()
    for (const b of bookings) map.set(b.booking_date, [...(map.get(b.booking_date) ?? []), b])
    for (const list of map.values()) list.sort((a, b) => a.booking_time.localeCompare(b.booking_time))
    return map
  }, [bookings])

  const cells = useMemo(() => monthGrid(year, month), [year, month])
  const title = firstUpper(new Intl.DateTimeFormat(INTL[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1))))
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(INTL[locale], { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + i))),
      ),
    [locale],
  )

  const shift = (delta: number) => {
    const m = month + delta
    setYear(year + Math.floor(m / 12))
    setMonth(((m % 12) + 12) % 12)
  }
  const goToday = () => {
    setYear(Number(today.slice(0, 4)))
    setMonth(Number(today.slice(5, 7)) - 1)
    setSelected(today)
  }

  const dayList = byDate.get(selected) ?? []

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-card lg:col-span-2">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-1.5">
            <Button size="icon-sm" variant="outline" onClick={() => shift(-1)} aria-label={t('bookings.calendar.prev')}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={goToday}>
              {t('bookings.calendar.today')}
            </Button>
            <Button size="icon-sm" variant="outline" onClick={() => shift(1)} aria-label={t('bookings.calendar.next')}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="p-3">
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
            {weekdays.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map(({ date, inMonth }) => {
              const list = byDate.get(date) ?? []
              const isToday = date === today
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelected(date)}
                  onDoubleClick={() => onCreateOn(date)}
                  className={cn(
                    'flex min-h-[84px] flex-col rounded-lg border p-1.5 text-left transition-colors sm:min-h-[96px]',
                    inMonth ? 'border-border bg-background hover:bg-muted/40' : 'border-transparent bg-muted/20 opacity-50',
                    selected === date && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        isToday ? 'flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground' : 'text-foreground',
                      )}
                    >
                      {Number(date.slice(8))}
                    </span>
                    {list.length > 0 && <span className="text-[10px] font-semibold text-muted-foreground">{list.length}</span>}
                  </div>
                  <div className="mt-1 hidden space-y-0.5 overflow-hidden sm:block">
                    {list.slice(0, 2).map((b) => (
                      <div key={b.id} className={cn('truncate rounded border px-1 py-0.5 text-[10px]', STATUS_STYLE[b.status])}>
                        {b.booking_time} {customerName(b)}
                      </div>
                    ))}
                    {list.length > 2 && <div className="text-center text-[10px] text-muted-foreground">+{list.length - 2}</div>}
                  </div>
                  {list.length > 0 && <div className="mt-auto h-1 rounded-full bg-primary/60 sm:hidden" />}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('bookings.calendar.hint')}</p>
        </div>
      </div>

      <div className="flex flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Clock className="size-4 text-primary" />
            {firstUpper(formatBookingDate(selected, locale))}
          </h3>
          <Button size="sm" onClick={() => onCreateOn(selected)} disabled={selected < today}>
            <Plus className="size-3.5" />
            {t('bookings.actions.add')}
          </Button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {dayList.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <CalendarDays className="mx-auto mb-2 size-8 opacity-50" />
              {t('bookings.calendar.emptyDay', { bookings: label('bookingPlural').toLocaleLowerCase(locale) })}
            </div>
          ) : (
            dayList.map((b) => (
              <div key={b.id} className="space-y-2 rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {formatBookingTime(b.booking_time, locale)}
                    {b.duration_minutes ? <span className="font-normal text-muted-foreground"> · {t('bookings.minutes', { n: b.duration_minutes })}</span> : null}
                  </span>
                  <StatusSelect value={b.status} onChange={(s) => h.onStatus(b, s)} />
                </div>
                <div>
                  <button type="button" onClick={() => h.onCustomer(b)} className="text-left text-sm font-semibold text-foreground hover:text-primary hover:underline">
                    {customerName(b) || t('bookings.unnamed')}
                  </button>
                  {(b.staff || b.service) && (
                    <div className="text-xs text-muted-foreground">{[b.staff?.name, b.service?.name].filter(Boolean).join(' · ')}</div>
                  )}
                  {b.party_size ? <div className="text-xs text-muted-foreground">{t('bookings.people', { n: b.party_size })}</div> : null}
                </div>
                <MessageButtons booking={b} sending={h.sending} onSend={h.onSend} size="xs" />
                <div className="flex justify-end gap-1 border-t border-border pt-2">
                  <Button size="xs" variant="ghost" onClick={() => h.onOpen(b)}>
                    {t('bookings.actions.view')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => h.onEdit(b)}>
                    {t('bookings.actions.edit')}
                  </Button>
                  <Button size="xs" variant="ghost" className="hover:text-destructive" onClick={() => h.onDelete(b)}>
                    {t('bookings.actions.delete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
