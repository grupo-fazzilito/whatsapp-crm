import { redirect } from 'next/navigation';

// The business numbers now live as widgets on the main dashboard.
export default function BusinessDashboardPage() {
  redirect('/dashboard');
}
