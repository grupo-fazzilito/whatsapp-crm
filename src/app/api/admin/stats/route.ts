import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function isAuthed(): Promise<boolean> {
  return isPlatformAdmin();
}

export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();

  const { data: authData } = await db.auth.admin.listUsers({ perPage: 500 });
  const users = (authData?.users ?? []) as { id: string; created_at?: string; email_confirmed_at?: string }[];

  const now = new Date();
  const monthlySignups: { month: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const count = users.filter(u => (u.created_at ?? "").startsWith(key)).length;
    monthlySignups.push({ month: d.toLocaleString("en-US", { month: "short" }), count });
  }

  if (users.length === 0) {
    return NextResponse.json({
      totalUsers: 0, activeUsers: 0, confirmedUsers: 0,
      totalContacts: 0, totalConversations: 0, openConversations: 0,
      monthlySignups,
    });
  }

  // Platform-wide totals across every workspace. Counted server-side so
  // they aren't capped by the API row limit.
  const [waConnected, contacts, conversations, openConversations] = await Promise.all([
    db.from("channels").select("id", { count: "exact", head: true }).eq("status", "connected"),
    db.from("contacts").select("id", { count: "exact", head: true }),
    db.from("conversations").select("id", { count: "exact", head: true }),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const confirmedCount = users.filter(u => !!u.email_confirmed_at).length;

  return NextResponse.json({
    totalUsers:         users.length,
    // Workspaces with a connected WhatsApp integration (one config per workspace)
    activeUsers:        waConnected.count ?? 0,
    confirmedUsers:     confirmedCount,
    totalContacts:      contacts.count ?? 0,
    totalConversations: conversations.count ?? 0,
    openConversations:  openConversations.count ?? 0,
    monthlySignups,
  });
}
