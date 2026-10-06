'use client'

import { BellRing, Check, HeartHandshake, Loader2, Send, Star } from 'lucide-react'
import { useT } from '@/i18n/client'
import { Button } from '@/components/ui/button'
import { ACTIVE_STATUSES, type Booking, type MessageAction } from './types'

const ICON = { confirm: Send, reminder: BellRing, feedback: Star, followup: HeartHandshake } as const

/** Customer-message shortcuts that make sense for the booking's status. */
export function MessageButtons({
  booking,
  sending,
  onSend,
  size = 'sm',
}: {
  booking: Booking
  sending: { id: string; action: MessageAction } | null
  onSend: (b: Booking, action: MessageAction) => void
  size?: 'sm' | 'xs'
}) {
  const t = useT()
  const actions: MessageAction[] = ACTIVE_STATUSES.includes(booking.status)
    ? ['confirm', 'reminder']
    : booking.status === 'completed'
      ? ['feedback', 'followup']
      : []
  if (actions.length === 0) return <span className="text-xs text-muted-foreground">—</span>

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actions.map((action) => {
        const Icon = ICON[action]
        const busy = sending?.id === booking.id && sending.action === action
        const done = (action === 'feedback' && booking.feedback_sent) || (action === 'followup' && booking.followup_sent)
        return (
          <Button
            key={action}
            type="button"
            size={size}
            variant="outline"
            disabled={sending !== null || !booking.contact_id}
            onClick={() => onSend(booking, action)}
            title={t(`bookings.messagesUi.${action}Hint`)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : done ? <Check className="size-3" /> : <Icon className="size-3" />}
            {t(`bookings.messagesUi.${action}`)}
          </Button>
        )
      })}
    </div>
  )
}
