'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '@/i18n/client'
import { createClient } from '@/lib/supabase/client'
import type { Booking, BookingStatus, MessageAction } from './types'
import { pushGoogleSync } from '@/components/integrations/google/push'

const ENDPOINT: Record<MessageAction, string> = {
  confirm: '/api/business/bookings/confirm',
  reminder: '/api/business/bookings/reminder',
  feedback: '/api/business/bookings/followup-feedback',
  followup: '/api/business/bookings/followup-feedback',
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
  return data as { success: boolean; skipped?: boolean; simulated?: boolean }
}

/** Status changes and customer messages for bookings. */
export function useBookingActions(patch: (id: string, changes: Partial<Booking>) => void) {
  const t = useT()
  const [sending, setSending] = useState<{ id: string; action: MessageAction } | null>(null)

  /** Fire-and-forget customer notice about the booking's current status. */
  const notifyStatus = useCallback(
    (bookingId: string) => {
      post('/api/business/bookings/status-notify', { bookingId })
        .then((r) => {
          if (!r.skipped) toast.success(t('bookings.toast.customerNotified'))
        })
        .catch((err: Error) => toast.error(t('bookings.toast.notifyFailed', { error: err.message })))
    },
    [t],
  )

  const changeStatus = useCallback(
    async (booking: Booking, status: BookingStatus, notify = true) => {
      if (status === booking.status) return true
      const previous = booking.status
      patch(booking.id, { status })
      const { error } = await createClient().from('bookings').update({ status }).eq('id', booking.id)
      if (error) {
        patch(booking.id, { status: previous })
        toast.error(error.message)
        return false
      }
      toast.success(t('bookings.toast.statusChanged', { status: t(`bookings.status.${status}`) }))
      pushGoogleSync(booking.id)
      if (notify) notifyStatus(booking.id)
      return true
    },
    [patch, notifyStatus, t],
  )

  const sendMessage = useCallback(
    async (booking: Booking, action: MessageAction) => {
      setSending({ id: booking.id, action })
      try {
        const body = action === 'feedback' || action === 'followup' ? { bookingId: booking.id, type: action } : { bookingId: booking.id }
        const r = await post(ENDPOINT[action], body)
        if (r.skipped) {
          toast.info(t('bookings.toast.messageSkipped'))
          return
        }
        toast.success(t(`bookings.toast.sent.${action}`))
        if (action === 'feedback') patch(booking.id, { feedback_sent: true })
        if (action === 'followup') patch(booking.id, { followup_sent: true })
      } catch (err) {
        toast.error(t('bookings.toast.sendFailed', { error: err instanceof Error ? err.message : String(err) }))
      } finally {
        setSending(null)
      }
    },
    [patch, t],
  )

  return { sending, changeStatus, sendMessage, notifyStatus }
}
