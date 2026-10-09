import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextResponse } from "next/server";
import { listUsersForAdmin } from "@/lib/auth/users";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let accounts: Awaited<ReturnType<typeof listUsersForAdmin>>;
  try {
    accounts = await listUsersForAdmin();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  // Profiles for display names.
  const profiles = await prisma.profiles.findMany({ select: { user_id: true, full_name: true, avatar_url: true, email: true } }).catch(() => []);
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

  const users = accounts.map((u) => {
    const profile = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "",
      full_name: profile?.full_name ?? u.user_metadata?.full_name ?? "",
      avatar_url: profile?.avatar_url ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: !!u.email_confirmed_at,
      provider: u.app_metadata?.provider ?? "email",
    };
  });

  return NextResponse.json({ users });
}
