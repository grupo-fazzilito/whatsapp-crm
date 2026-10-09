'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, Loader2, MessageSquare, Phone, Stethoscope } from 'lucide-react'
import { useI18n } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { api } from '@/components/business/api'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { IntakeDetails, UrgencyBadge, type Intake } from './intake-panel'
import { StatusBadge } from './status-select'
import { ACTIVE_STATUSES, type Booking, type ContactLite } from './types'

interface Feedback {
  id: string
  rating: number | null
  feedback_text: string | null
  created_at: string
}

type Tab = 'history' | 'intakes' | 'feedback'

/** A customer's bookings, feedback and (clinic) intakes. */
export function CustomerHistoryDialog({
  contact,
  bookings,
  today,
  onClose,
  onOpenBooking,
}: {
  contact: ContactLite | null
  /** All loaded bookings; filtered to this contact here. */
  bookings: Booking[]
  today: string
  onClose: () => void
  onOpenBooking: (b: Booking) => void
}) {
  const { t, locale } = useI18n()
  const { label, modules } = useWorkspace()
  const [tab, setTab] = useState<Tab>('history')
  const [loading, setLoading] = useState(true)
  const [intakes, setIntakes] = useState<Intake[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const contactId = contact?.id

  useEffect(() => {
    if (!contactId) return
    let cancelled = false
    api<{ intakes: Intake[]; feedback: Feedback[] }>(
      `/api/bookings/history?contact_id=${encodeURIComponent(contactId)}${modules.triage ? '&intakes=1' : ''}`,
    )
      .catch(() => ({ intakes: [] as Intake[], feedback: [] as Feedback[] }))
      .then((d) => {
        if (cancelled) return
        setIntakes(d.intakes)
        setFeedback(d.feedback)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contactId, modules.triage])

  const mine = useMemo(() => bookings.filter((b) => b.contact_id === contactId), [bookings, contactId])
  const next = useMemo(
    () =>
      mine
        .filter((b) => ACTIVE_STATUSES.includes(b.status) && b.booking_date >= today)
        .sort((a, b) => (a.booking_date + a.booking_time).localeCompare(b.booking_date + b.booking_time))[0],
    [mine, today],
  )
  const first = useMemo(() => [...mine].sort((a, b) => a.booking_date.localeCompare(b.booking_date))[0], [mine])

  if (!contact) return null
  const tabs: { id: Tab; icon: typeof Activity; text: string }[] = [
    { id: 'history', icon: Activity, text: t('bookings.history.tabs.history', { n: mine.length }) },
    ...(modules.triage ? [{ id: 'intakes' as Tab, icon: Stethoscope, text: t('bookings.history.tabs.intakes', { n: intakes.length }) }] : []),
    { id: 'feedback', icon: MessageSquare, text: t('bookings.history.tabs.feedback', { n: feedback.length }) },
  ]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact.name || contact.phone || label('customer')}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Phone className="size-3" />
            {contact.phone || t('bookings.history.noPhone')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">{label('bookingPlural')}</div>
            <div className="text-lg font-bold text-foreground">{mine.length}</div>
          </div>
          <div className="rounded-lg border border-border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">{t('bookings.history.first')}</div>
            <div className="text-xs font-medium text-foreground">{first ? formatBookingDate(first.booking_date, locale) : '—'}</div>
          </div>
          <div className="rounded-lg border border-border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">{t('bookings.history.next')}</div>
            <div className="text-xs font-medium text-foreground">
              {next ? `${formatBookingDate(next.booking_date, locale)} · ${formatBookingTime(next.booking_time, locale)}` : '—'}
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-b border-border">
          {tabs.map(({ id, icon: Icon, text }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-1 pb-2 text-xs font-semibold',
                tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {text}
            </button>
          ))}
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto">
          {tab === 'history' ? (
            mine.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">{t('bookings.history.empty')}</p>
            ) : (
              <div className="space-y-2">
                {mine.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onOpenBooking(b)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground">
                        {formatBookingDate(b.booking_date, locale)} · {formatBookingTime(b.booking_time, locale)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{[b.staff?.name, b.service?.name].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    <StatusBadge status={b.status} />
                  </button>
                ))}
              </div>
            )
          ) : loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === 'intakes' ? (
            intakes.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">{t('bookings.history.noIntakes')}</p>
            ) : (
              <div className="space-y-2">
                {intakes.map((i) => (
                  <div key={i.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString(locale)}
                      <UrgencyBadge level={i.urgency_level} />
                    </div>
                    <IntakeDetails intake={i} />
                  </div>
                ))}
              </div>
            )
          ) : feedback.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">{t('bookings.history.noFeedback')}</p>
          ) : (
            <div className="space-y-2">
              {feedback.map((f) => (
                <div key={f.id} className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleDateString(locale)}
                    <span aria-label={t('bookings.history.rating', { n: f.rating ?? 0 })} className="text-sm tracking-tight">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span key={s} className={s <= Number(f.rating || 0) ? 'text-amber-500' : 'text-muted-foreground/40'}>
                          ★
                        </span>
                      ))}
                    </span>
                  </div>
                  <p className="text-xs italic text-foreground">{f.feedback_text || t('bookings.history.noComment')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
