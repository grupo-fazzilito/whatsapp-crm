import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth/server'

// Better Auth endpoints (/api/auth/sign-in/email, /sign-out, /get-session, …).
// Built per request so importing this module needs no database at build time.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request)
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request)
}
