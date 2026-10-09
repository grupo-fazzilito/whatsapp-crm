'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/components/business/api'
import { useRealtimeChanges } from '@/lib/realtime/client'
import type { BusinessHoursRow } from '@/lib/ai/slots'
import type { Workspace } from '@/lib/workspace/types'
import type { StaffOption } from './availability'
import type { Booking, ProductLite, ServiceLite } from './types'

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

export function useBookingsData(workspace: Workspace | null, withProducts: boolean): BookingsData {
  const [loading, setLoading] = useState(true)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [services, setServices] = useState<ServiceLite[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [hours, setHours] = useState<BusinessHoursRow[]>([])

  const reloadBookings = useCallback(async () => {
    try {
      const data = await api<{ bookings: Booking[] }>('/api/bookings')
      setBookings(data.bookings)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const [options] = await Promise.all([
        api<{ staff: StaffOption[]; services: ServiceLite[]; hours: BusinessHoursRow[]; products: ProductLite[] }>(
          `/api/bookings/options${withProducts ? '?products=1' : ''}`,
        ).catch(() => null),
        reloadBookings(),
      ])
      if (options) {
        setStaff(options.staff)
        setServices(options.services)
        setHours(options.hours)
        if (withProducts) setProducts(options.products)
      }
    } finally {
      setLoading(false)
    }
  }, [reloadBookings, withProducts])

  useEffect(() => {
    if (workspace) reload()
  }, [workspace, reload])

  // Bookings created by the AI agent or other members show up live.
  useRealtimeChanges({
    workspaceId: workspace?.id,
    tables: ['bookings'],
    onChange: () => {
      reloadBookings()
    },
  })

  const patch = useCallback((id: string, changes: Partial<Booking>) => {
    setBookings((list) => list.map((b) => (b.id === id ? { ...b, ...changes } : b)))
  }, [])

  return { loading, bookings, staff, services, products, hours, reload, patch }
}
