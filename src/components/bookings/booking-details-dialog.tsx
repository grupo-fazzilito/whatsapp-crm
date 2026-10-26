'use client'

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import type { BookingField } from '@/lib/industries'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { customFieldDefs } from './fields'
import { IntakePanel } from './intake-panel'
import { MessageButtons } from './message-buttons'
import { StatusSelect } from './status-select'
import { customerName, type Booking, type BookingStatus, type MessageAction, type ProductLite } from './types'

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  )
}

export function BookingDetailsDialog({
  booking,
  fields,
  products,
  onClose,
  onEdit,
  onDelete,
  onStatus,
  onSend,
  onCustomer,
  sending,
}: {
  booking: Booking | null
  fields: BookingField[]
  products: ProductLite[]
  onClose: () => void
  onEdit: (b: Booking) => void
  onDelete: (b: Booking) => void
  onStatus: (b: Booking, s: BookingStatus) => void
  onSend: (b: Booking, a: MessageAction) => void
  onCustomer: (b: Booking) => void
  sending: { id: string; action: MessageAction } | null
}) {
  const { t, locale } = useI18n()
  const { label, modules } = useWorkspace()
  if (!booking) return null
  const b = booking
  const values = b.custom_fields ?? {}
  const defs = customFieldDefs(fields)
  const extra = Object.entries(values).filter(([k, v]) => !defs.some((f) => f.key === k) && v !== null && v !== '' && typeof v !== 'object')
  const productField = fields.find((f) => f.type === 'product')
  const product = b.product_id ? products.find((p) => p.id === b.product_id) : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <DialogTitle>{customerName(b) || t('bookings.unnamed')}</DialogTitle>
            <StatusSelect value={b.status} onChange={(s) => onStatus(b, s)} />
          </div>
          <DialogDescription>
            {label('booking')} · {formatBookingDate(b.booking_date, locale)} · {formatBookingTime(b.booking_time, locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Item label={label('customer')}>
                <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => onCustomer(b)}>
                  {b.contact?.name || b.contact?.phone || '—'}
                </button>
                {b.contact?.phone && <div className="text-xs text-muted-foreground">{b.contact.phone}</div>}
              </Item>
              <Item label={t('bookings.fields.when')}>
                {formatBookingTime(b.booking_time, locale)}
                <div className="text-xs text-muted-foreground">{t('bookings.minutes', { n: b.duration_minutes ?? 30 })}</div>
              </Item>
              {modules.staff && (
                <Item label={label('staff')}>
                  {b.staff?.name ?? '—'}
                  {b.staff?.title && <div className="text-xs text-muted-foreground">{b.staff.title}</div>}
                </Item>
              )}
              {modules.services && <Item label={label('service')}>{b.service?.name ?? '—'}</Item>}
              {b.party_size ? <Item label={t('bookings.form.partySize')}>{t('bookings.people', { n: b.party_size })}</Item> : null}
              {productField && b.product_id && <Item label={productField.label[locale]}>{product?.name ?? b.product_id}</Item>}
              {defs
                .filter((f) => values[f.key] !== undefined && values[f.key] !== null && values[f.key] !== '')
                .map((f) => (
                  <Item key={f.key} label={f.label[locale]}>
                    {String(values[f.key])}
                  </Item>
                ))}
              {extra.map(([k, v]) => (
                <Item key={k} label={k}>
                  {String(v)}
                </Item>
              ))}
              <Item label={t('bookings.fields.source')}>{t(`bookings.source.${b.source === 'ai' || b.source === 'flow' || b.source === 'picker' ? b.source : 'manual'}`)}</Item>
            </div>
            {b.notes && (
              <Item label={t('bookings.form.notes')}>
                <p className="whitespace-pre-wrap">{b.notes}</p>
              </Item>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <MessageSquare className="size-3.5 text-primary" />
                {t('bookings.messagesUi.title')}
              </h4>
              <MessageButtons booking={b} sending={sending} onSend={onSend} />
              {b.reminder_error && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {t('bookings.reminders.lastError', { reason: t(`bookings.reminders.error.${b.reminder_error}`) })}
                </p>
              )}
              {b.conversation_id && (
                <Link href={`/inbox?c=${b.conversation_id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
                  {t('bookings.actions.openChat')}
                </Link>
              )}
            </div>
            {modules.triage && <IntakePanel booking={b} />}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDelete(b)}>
            {t('bookings.actions.delete')}
          </Button>
          <Button onClick={() => onEdit(b)}>{t('bookings.actions.edit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
