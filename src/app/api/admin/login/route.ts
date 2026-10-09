import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { findUserByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { withAuthCookies } from "@/lib/auth/cookies";

// Platform admin sign-in: a normal account flagged as profiles.is_platform_admin
// (or listed in PLATFORM_ADMIN_EMAILS, promoted on first sign-in).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.username ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Check the password before revealing whether the account is an admin.
  const user = await findUserByEmail(email);
  const account = user ? await prisma.auth_accounts.findFirst({ where: { user_id: user.id, provider_id: "credential" } }) : null;
  if (!user || !account?.password || user.banned || !(await verifyPassword({ hash: account.password, password }))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const profile = await prisma.profiles.findUnique({ where: { user_id: user.id }, select: { is_platform_admin: true } }).catch(() => null);
  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  let isAdmin = !!profile?.is_platform_admin;
  if (!isAdmin && allow.includes(email)) {
    await prisma.profiles.updateMany({ where: { user_id: user.id }, data: { is_platform_admin: true } }).catch(() => {});
    isAdmin = true;
  }
  if (!isAdmin) {
    return NextResponse.json({ error: "This account is not a platform admin" }, { status: 403 });
  }

  const res = await auth().api.signInEmail({ body: { email, password }, headers: req.headers, asResponse: true });
  if (!res.ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  return withAuthCookies(res, NextResponse.json({ ok: true }));
}

export async function DELETE(req: NextRequest) {
  const res = await auth().api.signOut({ headers: req.headers, asResponse: true }).catch(() => null);
  const out = NextResponse.json({ ok: true });
  return res ? withAuthCookies(res, out) : out;
}
