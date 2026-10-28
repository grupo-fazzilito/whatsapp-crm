import { NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/site-origin';

// Supabase Auth used this URL for email links (code exchange). Accounts are
// verified with one-time codes now; old links land on the login page.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL('/login', publicOrigin(request)));
}
