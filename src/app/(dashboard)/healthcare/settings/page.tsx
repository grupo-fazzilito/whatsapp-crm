import { redirect } from 'next/navigation';

// Moved to the industry-neutral business module.
export default function LegacyHealthcarePage() {
  redirect('/agents');
}
