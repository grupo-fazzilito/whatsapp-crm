'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  businessWindows,
  freeSlotsForBusiness,
  freeSlotsForStaff,
  type BookingRow,
  type BusinessException,
  type BusinessHoursRow,
  type SlotQuery,
  type StaffRow,
} from '@/lib/ai/slots'
import { isIsoDate, safeTimeZone, zonedNow } from '@/lib/ai/time'
import type { Workspace } from '@/lib/workspace/types'

export interface StaffOption extends StaffRow {
  title: string | null
  service_ids: string[]
}

export interface AvailabilityInput {
  workspace: Workspace
  hours: BusinessHoursRow[]
  staff: StaffOption[]
  date: string
  durationMinutes: number
  staffId: string | null
  serviceId: string | null
  /** Staff must be chosen (industry preset) — otherwise any free staff works. */
  needsStaff: boolean
  /** Booking being edited, left out of the conflicts. */
  excludeId?: string | null
}

export interface Availability {
  loading: boolean
  /** Business closed that day (holiday / closed weekday). */
  closed: boolean
  /** Free start times 'HH:MM' for the current selection. */
  slots: string[]
}

/** Staff members that can perform `serviceId` (all when unlinked). */
export function eligibleStaff(staff: StaffOption[], serviceId: string | null) {
  return staff.filter((s) => !serviceId || s.service_ids.length === 0 || s.service_ids.includes(serviceId))
}

/** Pure availability for one date given the active bookings of that date. */
export function computeSlots(input: AvailabilityInput, bookings: BookingRow[]): Omit<Availability, 'loading'> {
  const { workspace } = input
  const exceptions = (workspace.date_exceptions ?? []) as BusinessException[]
  if (!isIsoDate(input.date)) return { closed: false, slots: [] }
  if (!businessWindows(input.date, input.hours, exceptions)) return { closed: true, slots: [] }

  const now = zonedNow(safeTimeZone(workspace.timezone))
  const q: SlotQuery = {
    hours: input.hours,
    exceptions,
    bookings,
    today: now.date,
    nowTime: now.time,
    durationMinutes: Math.max(5, input.durationMinutes || 30),
    stepMinutes: 15,
    capacity: Number(workspace.settings?.booking_capacity ?? 1),
  }

  const candidates = eligibleStaff(input.staff, input.serviceId)
  if (input.staff.length > 0 && (input.staffId || input.needsStaff)) {
    const pool = input.staffId ? candidates.filter((s) => s.id === input.staffId) : candidates
    const all = new Set(pool.flatMap((s) => freeSlotsForStaff(s, input.date, q)))
    return { closed: false, slots: [...all].sort() }
  }
  return { closed: false, slots: freeSlotsForBusiness(input.date, q) }
}

/** Live availability for the booking form (re-reads that day's bookings). */
export function useAvailability(input: AvailabilityInput | null): Availability {
  const [state, setState] = useState<Availability>({ loading: false, closed: false, slots: [] })
  const key = input
    ? [input.date, input.durationMinutes, input.staffId, input.serviceId, input.excludeId, input.staff.length, input.hours.length].join('|')
    : ''

  useEffect(() => {
    if (!input || !isIsoDate(input.date)) {
      setState({ loading: false, closed: false, slots: [] })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    createClient()
      .from('bookings')
      .select('id, staff_id, booking_date, booking_time, duration_minutes, status, party_size')
      .eq('booking_date', input.date)
      .in('status', ['pending', 'confirmed'])
      .then(({ data }) => {
        if (cancelled) return
        const rows = ((data ?? []) as (BookingRow & { id: string })[]).filter((b) => b.id !== input.excludeId)
        setState({ loading: false, ...computeSlots(input, rows) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
