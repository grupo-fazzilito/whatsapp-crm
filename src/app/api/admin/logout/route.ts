import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { withAuthCookies } from "@/lib/auth/cookies";

export async function POST(req: Request) {
  const res = await auth().api.signOut({ headers: req.headers, asResponse: true }).catch(() => null);
  const out = NextResponse.json({ ok: true });
  return res ? withAuthCookies(res, out) : out;
}
