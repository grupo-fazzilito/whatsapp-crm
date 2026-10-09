import 'server-only'
import { sanitizeLeadPatch } from './profile'
import { getLeadProfile, saveLeadProfile } from './service'
import type { LeadProfile } from './types'
import type { CaptureOutput } from './prompt-section'
import { createCapture } from '@/lib/real-estate/captures'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'

// Glue between the AI engine and the lead module. Every function here
// swallows its errors: lead bookkeeping must never break a reply.

export async function leadForPrompt(workspaceId: string, contactId: string): Promise<LeadProfile | null> {
  try {
    return await getLeadProfile(workspaceId, contactId)
  } catch (err) {
    console.error('[leads] profile load failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Merges the model's `lead_profile` output (only non-empty values). */
export async function applyAiLeadProfile(input: {
  workspaceId: string
  contactId: string
  conversationId: string
  raw: unknown
}): Promise<void> {
  try {
    const patch = sanitizeLeadPatch(input.raw)
    if (!Object.keys(patch).length) return
    const res = await saveLeadProfile({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      patch,
      by: 'ai',
    })
    if (process.env.AI_DEBUG && res) {
      console.log('[leads] profile saved:', JSON.stringify({ score: res.profile.score, temperature: res.profile.temperature, qualified: res.becameQualified, routedTo: res.routedTo }))
    }
  } catch (err) {
    console.error('[leads] AI profile merge failed:', err instanceof Error ? err.message : err)
  }
}

const CAPTURE_KEYS = [
  'operation', 'property_type', 'district', 'address', 'area_m2', 'bedrooms', 'bathrooms', 'parking',
  'expected_price', 'currency', 'owner_name', 'owner_phone', 'description',
] as const

/** Non-empty capture fields of the model output. */
export function captureFields(c: CaptureOutput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of CAPTURE_KEYS) {
    const v = c[k]
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !(v > 0))) continue
    out[k] = v
  }
  return out
}

/**
 * Owner offering their property: once the model flags the capture as
 * complete it is registered through createCapture (which notifies the
 * admins); later turns only add details to that same capture. The id is
 * kept in the conversation's ai_state (mutated in place so the engine's
 * later state writes keep it).
 */
export async function applyAiCapture(input: {
  workspaceId: string
  contactId: string
  conversationId: string
  capture: CaptureOutput
  state: Record<string, unknown>
}): Promise<string | null> {
  try {
    const known = typeof input.state.capture_id === 'string'
    if (!input.capture.complete && !known) return null
    let fields = captureFields(input.capture)
    if (!Object.keys(fields).length) return known ? (input.state.capture_id as string) : null
    let res = await createCapture({ workspaceId: input.workspaceId, contactId: input.contactId, conversationId: input.conversationId, fields, source: 'ai' })
    if (!res.ok && res.error === 'invalid') {
      // Drop what the model got wrong and keep the rest.
      const bad = new Set(Object.keys(res.errors))
      fields = Object.fromEntries(Object.entries(fields).filter(([k]) => !bad.has(k)))
      res = await createCapture({ workspaceId: input.workspaceId, contactId: input.contactId, conversationId: input.conversationId, fields, source: 'ai' })
    }
    if (!res.ok) {
      console.error('[leads] capture failed:', res.error)
      return null
    }
    if (!known || input.state.capture_id !== res.capture.id) {
      input.state.capture_id = res.capture.id
      await tenantDb(input.workspaceId)
        .conversations.updateMany({ where: { id: input.conversationId }, data: { ai_state: input.state as Prisma.InputJsonValue } })
        .catch(() => undefined)
    }
    if (process.env.AI_DEBUG) console.log('[leads] capture saved:', res.capture.id, res.created ? 'created' : 'updated')
    return res.capture.id
  } catch (err) {
    console.error('[leads] capture failed:', err instanceof Error ? err.message : err)
    return null
  }
}
