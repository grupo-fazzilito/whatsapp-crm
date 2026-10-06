import { redirect } from 'next/navigation'

// Appointments now live in the generic bookings module.
export default function AppointmentsRedirect() {
  redirect('/business/bookings')
}
