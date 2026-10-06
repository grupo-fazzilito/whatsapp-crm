'use client'

import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { BOOKING_STATUSES, STATUS_STYLE, type BookingStatus } from './types'

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const t = useT()
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[status], className)}>
      {t(`bookings.status.${status}`)}
    </span>
  )
}

export function StatusSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: BookingStatus
  onChange: (s: BookingStatus) => void
  disabled?: boolean
  className?: string
}) {
  const t = useT()
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={t('bookings.fields.status')}
      onChange={(e) => onChange(e.target.value as BookingStatus)}
      className={cn(
        'cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        STATUS_STYLE[value],
        className,
      )}
    >
      {BOOKING_STATUSES.map((s) => (
        <option key={s} value={s} className="bg-popover text-popover-foreground">
          {t(`bookings.status.${s}`)}
        </option>
      ))}
    </select>
  )
}
