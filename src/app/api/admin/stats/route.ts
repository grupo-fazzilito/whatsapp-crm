import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db/prisma";

async function isAuthed(): Promise<boolean> {
  return isPlatformAdmin();
}

export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Auth users still come from Supabase Auth (moves with the login, P3).
  const { data: authData } = await supabaseAdmin().auth.admin.listUsers({ perPage: 500 });
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

  // Platform-wide totals across every workspace (platform client). Counted
  // server-side so they aren't capped by a row limit. A failed count is 0.
  const count = (p: Promise<number>) => p.then((n) => ({ count: n }), () => ({ count: null as number | null }));
  const [waConnected, contacts, conversations, openConversations] = await Promise.all([
    count(prisma.channels.count({ where: { status: "connected" } })),
    count(prisma.contacts.count()),
    count(prisma.conversations.count()),
    count(prisma.conversations.count({ where: { status: "open" } })),
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
