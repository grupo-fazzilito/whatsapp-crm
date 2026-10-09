'use client'

import { createAuthClient } from 'better-auth/react'

// Browser auth client: signIn.email, signOut, useSession, changePassword,
// revokeOtherSessions… (talks to /api/auth/[...all]).
export const authClient = createAuthClient()
