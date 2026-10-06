'use client'

import { CalendarDays, Clock, Eye, Pencil, Trash2, Users } from 'lucide-react'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import type { BookingField } from '@/lib/industries'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'
import { Button } from '@/components/ui/button'
import { customFieldSummary } from './fields'
import { MessageButtons } from './message-buttons'
import { StatusSelect } from './status-select'
import { customerName, type Booking, type BookingStatus, type MessageAction } from './types'

export interface BookingRowHandlers {
  onOpen: (b: Booking) => void
  onEdit: (b: Booking) => void
  onDelete: (b: Booking) => void
  onStatus: (b: Booking, s: BookingStatus) => void
  onSend: (b: Booking, a: MessageAction) => void
  onCustomer: (b: Booking) => void
  sending: { id: string; action: MessageAction } | null
}

export function BookingList({ bookings, fields, ...h }: { bookings: Booking[]; fields: BookingField[] } & BookingRowHandlers) {
  const { t, locale } = useI18n()
  const { label, modules } = useWorkspace()
  const showStaff = modules.staff
  const showService = modules.services

  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <CalendarDays className="mx-auto mb-3 size-10 text-muted-foreground/60" />
        <p className="font-medium text-foreground">{t('bookings.empty.title', { bookings: label('bookingPlural').toLocaleLowerCase(locale) })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('bookings.empty.hint')}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-semibold">{label('customer')}</th>
            {(showStaff || showService) && (
              <th className="px-4 py-3 font-semibold">{showStaff ? label('staff') : label('service')}</th>
            )}
            <th className="px-4 py-3 font-semibold">{t('bookings.fields.when')}</th>
            <th className="px-4 py-3 font-semibold">{t('bookings.fields.status')}</th>
            <th className="px-4 py-3 font-semibold">{t('bookings.fields.messages')}</th>
            <th className="px-4 py-3 text-right font-semibold">{t('bookings.fields.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bookings.map((b) => {
            const summary = customFieldSummary(b, fields, locale)
            return (
              <tr key={b.id} className="align-top hover:bg-muted/30">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => h.onCustomer(b)} className="text-left font-semibold text-foreground hover:text-primary hover:underline">
                    {customerName(b) || t('bookings.unnamed')}
                  </button>
                  {b.contact?.phone && <div className="text-xs text-muted-foreground">{b.contact.phone}</div>}
                  {summary && <div className="mt-1 line-clamp-1 max-w-xs text-xs italic text-muted-foreground">{summary}</div>}
                  {b.source === 'ai' && (
                    <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {t('bookings.source.ai')}
                    </span>
                  )}
                </td>
                {(showStaff || showService) && (
                  <td className="px-4 py-3">
                    {showStaff && <div className="font-medium text-foreground">{b.staff?.name ?? '—'}</div>}
                    {showStaff && b.staff?.title && <div className="text-xs text-muted-foreground">{b.staff.title}</div>}
                    {showService && b.service && (
                      <div className={showStaff ? 'mt-1 text-xs text-muted-foreground' : 'font-medium text-foreground'}>{b.service.name}</div>
                    )}
                    {!showStaff && showService && !b.service && '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-xs">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <CalendarDays className="size-3.5 text-muted-foreground" />
                    {formatBookingDate(b.booking_date, locale)}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    {formatBookingTime(b.booking_time, locale)}
                    {b.duration_minutes ? ` · ${t('bookings.minutes', { n: b.duration_minutes })}` : ''}
                  </div>
                  {b.party_size ? (
                    <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                      <Users className="size-3.5" />
                      {t('bookings.people', { n: b.party_size })}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusSelect value={b.status} onChange={(s) => h.onStatus(b, s)} />
                </td>
                <td className="px-4 py-3">
                  <MessageButtons booking={b} sending={h.sending} onSend={h.onSend} size="xs" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" title={t('bookings.actions.view')} aria-label={t('bookings.actions.view')} onClick={() => h.onOpen(b)}>
                      <Eye className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title={t('bookings.actions.edit')} aria-label={t('bookings.actions.edit')} onClick={() => h.onEdit(b)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('bookings.actions.delete')}
                      aria-label={t('bookings.actions.delete')}
                      onClick={() => h.onDelete(b)}
                      className="hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
