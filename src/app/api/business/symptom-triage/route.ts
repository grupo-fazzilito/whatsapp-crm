import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { resolveIndustry } from '@/lib/industries'
import { completeJson, LlmUnavailableError, parseJsonLoose } from '@/lib/ai/llm'

/**
 * POST /api/business/symptom-triage — {symptoms, contactId?, intakeId?}
 *
 * Non-diagnostic symptom pre-screening for workspaces with the `triage`
 * module (clinic preset): urgency, which staff member/specialty fits, a
 * suggested action and general comfort advice. With `intakeId` the result
 * is stored on that patient_intake row.
 */

const URGENCY = ['emergency', 'urgent', 'routine', 'self_care'] as const

interface TriageResult {
  urgency: (typeof URGENCY)[number]
  recommended_specialist: string | null
  recommended_staff_id: string | null
  suggested_action: string
  care_advice: string
  should_escalate: boolean
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    urgency: { type: 'STRING', enum: [...URGENCY] },
    recommended_specialist: { type: 'STRING', nullable: true },
    recommended_staff_id: { type: 'STRING', nullable: true },
    suggested_action: { type: 'STRING' },
    care_advice: { type: 'STRING' },
    should_escalate: { type: 'BOOLEAN' },
  },
  required: ['urgency', 'suggested_action', 'care_advice', 'should_escalate'],
}

export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { workspace: ws, db } = guard.ctx

  if (!resolveIndustry(ws.industry, ws.settings).modules.triage) {
    return NextResponse.json({ error: 'Triage is not enabled for this workspace' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    symptoms?: string
    contactId?: string
    userId?: string
    intakeId?: string
  } | null
  const symptoms = body?.symptoms?.trim()
  if (!symptoms) return NextResponse.json({ error: 'symptoms are required' }, { status: 400 })

  const contactParam = body?.contactId ?? body?.userId
  let contactId: string | null = null
  if (contactParam && isUuid(contactParam)) {
    const data = await db.contacts.findFirst({ select: { id: true }, where: { id: contactParam } })
    contactId = data?.id ?? null
  }

  const staff = await db.staff.findMany({ select: { id: true, name: true, title: true }, where: { is_active: true }, orderBy: { name: 'asc' } })
  const staffList = staff.map((s) => `- ${s.name} (${s.title || 'General'}) [ID: ${s.id}]`).join('\n')
  const language = ws.locale === 'en' ? 'English' : 'Spanish'

  const system = `You are a medical triage assistant for "${ws.name}". You do NOT diagnose conditions or prescribe treatments. Assess the reported symptoms, decide the urgency and route to the right professional.

AVAILABLE PROFESSIONALS:
${staffList || 'None registered.'}

RULES:
- NEVER diagnose diseases or name specific medications.
- Flag emergencies (chest pain, trouble breathing, heavy bleeding, loss of consciousness, stroke signs) with urgency "emergency" and should_escalate true.
- recommended_staff_id must be one of the IDs above, or null.
- Write suggested_action and care_advice in ${language}, short and plain.

Answer with JSON: {"urgency": "emergency"|"urgent"|"routine"|"self_care", "recommended_specialist": string|null, "recommended_staff_id": string|null, "suggested_action": string, "care_advice": string, "should_escalate": boolean}`

  let result: TriageResult
  try {
    const raw = await completeJson({
      meter: { workspaceId: ws.id, purpose: 'triage' },
      system,
      turns: [{ role: 'user', content: `Patient reports: ${symptoms}` }],
      schema: SCHEMA,
      temperature: 0.1,
    })
    const parsed = parseJsonLoose<Partial<TriageResult>>(raw)
    if (!parsed || typeof parsed.suggested_action !== 'string') throw new Error('Invalid triage response')
    const validStaff = new Set(staff.map((s) => s.id))
    result = {
      urgency: URGENCY.includes(parsed.urgency as TriageResult['urgency']) ? (parsed.urgency as TriageResult['urgency']) : 'routine',
      recommended_specialist: parsed.recommended_specialist || null,
      recommended_staff_id: parsed.recommended_staff_id && validStaff.has(parsed.recommended_staff_id) ? parsed.recommended_staff_id : null,
      suggested_action: parsed.suggested_action,
      care_advice: typeof parsed.care_advice === 'string' ? parsed.care_advice : '',
      should_escalate: !!parsed.should_escalate || parsed.urgency === 'emergency',
    }
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return NextResponse.json({ error: 'IA no disponible: un administrador de la plataforma debe configurar un proveedor de IA (Panel de administración → Configuración).' }, { status: 503 })
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[triage] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Both writes are best effort, as before (errors never failed the request).
  if (body?.intakeId && isUuid(body.intakeId)) {
    await db.patient_intake
      .updateMany({ where: { id: body.intakeId }, data: { urgency_level: result.urgency, triage_result: { ...result } } })
      .catch((err) => console.error('[triage] intake update failed:', err instanceof Error ? err.message : err))
  }
  if (contactId) {
    await db.ai_chat_logs
      .create({
        data: {
          workspace_id: ws.id,
          contact_id: contactId,
          user_message: `[SYMPTOM TRIAGE] ${symptoms}`,
          ai_response: JSON.stringify(result),
          detected_intent: 'symptom_triage',
          confidence_score: 0.9,
        },
      })
      .catch((err) => console.error('[triage] chat log failed:', err instanceof Error ? err.message : err))
  }

  return NextResponse.json(result)
}
