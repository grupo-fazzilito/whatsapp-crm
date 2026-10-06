'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { BusinessHoursRow } from '@/lib/ai/slots'
import type { Workspace } from '@/lib/workspace/types'
import type { StaffOption } from './availability'
import { BOOKING_SELECT, type Booking, type ProductLite, type ServiceLite } from './types'

export interface BookingsData {
  loading: boolean
  bookings: Booking[]
  staff: StaffOption[]
  services: ServiceLite[]
  products: ProductLite[]
  hours: BusinessHoursRow[]
  reload: () => Promise<void>
  /** Optimistic local patch of one booking. */
  patch: (id: string, changes: Partial<Booking>) => void
}

const MAX_BOOKINGS = 2000

export function useBookingsData(workspace: Workspace | null, withProducts: boolean): BookingsData {
  const [loading, setLoading] = useState(true)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [services, setServices] = useState<ServiceLite[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [hours, setHours] = useState<BusinessHoursRow[]>([])

  const reloadBookings = useCallback(async () => {
    const { data, error } = await createClient()
      .from('bookings')
      .select(BOOKING_SELECT)
      .order('booking_date', { ascending: false })
      .order('booking_time', { ascending: false })
      .limit(MAX_BOOKINGS)
    if (error) toast.error(error.message)
    else setBookings((data ?? []) as unknown as Booking[])
  }, [])

  const reload = useCallback(async () => {
    const db = createClient()
    try {
      const [st, links, sv, bh] = await Promise.all([
        db.from('staff').select('*').eq('is_active', true).order('name'),
        db.from('staff_services').select('staff_id, service_id'),
        db.from('services').select('id, name, duration_minutes, price, is_active').order('name'),
        db.from('business_hours').select('day_name, opening_time, closing_time, is_closed, break_start, break_end'),
        reloadBookings(),
      ])
      const byStaff = new Map<string, string[]>()
      for (const l of links.data ?? []) byStaff.set(l.staff_id, [...(byStaff.get(l.staff_id) ?? []), l.service_id])
      setStaff(((st.data ?? []) as StaffOption[]).map((s) => ({ ...s, service_ids: byStaff.get(s.id) ?? [] })))
      setServices((sv.data ?? []) as ServiceLite[])
      setHours((bh.data ?? []) as BusinessHoursRow[])
      if (withProducts) {
        // The catalog may not exist yet in this deployment: ignore errors.
        const pr = await db.from('products').select('id, name').order('name').limit(500)
        setProducts(pr.error ? [] : ((pr.data ?? []) as ProductLite[]))
      }
    } finally {
      setLoading(false)
    }
  }, [reloadBookings, withProducts])

  useEffect(() => {
    if (workspace) reload()
  }, [workspace, reload])

  // Bookings created by the AI agent or other members show up live.
  useEffect(() => {
    if (!workspace) return
    const db = createClient()
    const channel = db
      .channel(`bookings-${workspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `workspace_id=eq.${workspace.id}` }, () => {
        reloadBookings()
      })
      .subscribe()
    return () => {
      db.removeChannel(channel)
    }
  }, [workspace, reloadBookings])

  const patch = useCallback((id: string, changes: Partial<Booking>) => {
    setBookings((list) => list.map((b) => (b.id === id ? { ...b, ...changes } : b)))
  }, [])

  return { loading, bookings, staff, services, products, hours, reload, patch }
}
