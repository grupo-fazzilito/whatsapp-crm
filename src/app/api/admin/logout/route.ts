import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  await (await createClient(null)).auth.signOut();
  return NextResponse.json({ ok: true });
}
