import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/guard";

// Platform admin sign-in: a normal Supabase account flagged as
// profiles.is_platform_admin (or listed in PLATFORM_ADMIN_EMAILS).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.username ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const supabase = await createClient(null);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  if (!(await isPlatformAdmin())) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This account is not a platform admin" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient(null);
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
