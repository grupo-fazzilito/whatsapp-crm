'use client'

import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Loader2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Booking } from './types'

export interface Intake {
  id: string
  contact_id: string
  booking_id: string | null
  symptoms: string | null
  allergies: string | null
  current_medications: string | null
  medical_history: string | null
  urgency_level: string | null
  triage_result: {
    suggested_action?: string
    care_advice?: string
    should_escalate?: boolean
    recommended_specialist?: string | null
  } | null
  created_at: string
}

const URGENCY_STYLE: Record<string, string> = {
  emergency: 'bg-red-500/10 text-red-600 border-red-500/30',
  urgent: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  routine: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  self_care: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
}

export function UrgencyBadge({ level }: { level: string | null }) {
  const t = useT()
  const key = level && URGENCY_STYLE[level] ? level : 'routine'
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', URGENCY_STYLE[key])}>
      {t(`bookings.intake.urgency.${key}`)}
    </span>
  )
}

export function IntakeDetails({ intake }: { intake: Intake }) {
  const t = useT()
  return (
    <div className="space-y-2 text-xs">
      <div>
        <span className="text-muted-foreground">{t('bookings.intake.symptoms')}</span>
        <p className="mt-0.5 rounded border border-border bg-background p-2 font-medium text-foreground">{intake.symptoms}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {intake.allergies && (
          <div>
            <span className="text-muted-foreground">{t('bookings.intake.allergies')}</span>
            <p className="font-medium text-foreground">{intake.allergies}</p>
          </div>
        )}
        {intake.current_medications && (
          <div>
            <span className="text-muted-foreground">{t('bookings.intake.medications')}</span>
            <p className="font-medium text-foreground">{intake.current_medications}</p>
          </div>
        )}
        {intake.medical_history && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t('bookings.intake.history')}</span>
            <p className="font-medium text-foreground">{intake.medical_history}</p>
          </div>
        )}
      </div>
      {intake.triage_result?.suggested_action && (
        <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-2">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-primary">
            <Sparkles className="size-3" /> {t('bookings.intake.aiAssessment')}
          </span>
          <p className="font-medium text-foreground">{intake.triage_result.suggested_action}</p>
          {intake.triage_result.recommended_specialist && (
            <p className="text-muted-foreground">
              {t('bookings.intake.specialist')}: {intake.triage_result.recommended_specialist}
            </p>
          )}
          {intake.triage_result.care_advice && <p className="italic text-muted-foreground">{intake.triage_result.care_advice}</p>}
          {intake.triage_result.should_escalate && (
            <p className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 p-1.5 font-bold text-red-600">
              <AlertCircle className="size-3.5" /> {t('bookings.intake.escalate')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const EMPTY = { symptoms: '', allergies: '', current_medications: '', medical_history: '' }

/** Pre-visit intake + AI triage for one booking (clinic / triage module). */
export function IntakePanel({ booking }: { booking: Booking }) {
  const t = useT()
  const { workspace } = useWorkspace()
  const [intake, setIntake] = useState<Intake | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [triaging, setTriaging] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const db = createClient()
      const { data } = await db.from('patient_intake').select('*').eq('booking_id', booking.id).maybeSingle()
      let found = data as Intake | null
      if (!found && booking.contact_id) {
        // Intake the AI collected before the booking existed: attach it.
        const { data: loose } = await db
          .from('patient_intake')
          .select('*')
          .eq('contact_id', booking.contact_id)
          .is('booking_id', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (loose) {
          const { data: linked } = await db.from('patient_intake').update({ booking_id: booking.id }).eq('id', loose.id).select('*').single()
          found = (linked ?? loose) as Intake
        }
      }
      if (!cancelled) {
        setIntake(found)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [booking.id, booking.contact_id])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!booking.contact_id || !form.symptoms.trim()) return
    setSaving(true)
    const { data, error } = await createClient()
      .from('patient_intake')
      .insert({
        workspace_id: workspace?.id,
        contact_id: booking.contact_id,
        booking_id: booking.id,
        symptoms: form.symptoms.trim(),
        allergies: form.allergies.trim() || null,
        current_medications: form.current_medications.trim() || null,
        medical_history: form.medical_history.trim() || null,
        urgency_level: 'routine',
        collected_via: 'dashboard',
      })
      .select('*')
      .single()
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setIntake(data as Intake)
    setShowForm(false)
    setForm(EMPTY)
    toast.success(t('bookings.intake.saved'))
  }

  const triage = async () => {
    if (!intake?.symptoms) return
    setTriaging(true)
    try {
      const res = await fetch('/api/business/symptom-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms: intake.symptoms, contactId: intake.contact_id, intakeId: intake.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setIntake({ ...intake, urgency_level: data.urgency, triage_result: data })
      toast.success(t('bookings.intake.triaged'))
    } catch (err) {
      toast.error(t('bookings.intake.triageFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setTriaging(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <h4 className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Activity className="size-3.5 text-primary" />
          {t('bookings.intake.title')}
        </span>
        {intake && <UrgencyBadge level={intake.urgency_level} />}
      </h4>
      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : intake ? (
        <>
          <IntakeDetails intake={intake} />
          {!intake.triage_result?.suggested_action && (
            <Button type="button" size="sm" className="w-full" disabled={triaging} onClick={triage}>
              {triaging ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {t('bookings.intake.runTriage')}
            </Button>
          )}
        </>
      ) : showForm ? (
        <form onSubmit={save} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="in-symptoms">{t('bookings.intake.symptoms')} *</Label>
            <Input id="in-symptoms" required value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="in-allergies">{t('bookings.intake.allergies')}</Label>
              <Input id="in-allergies" value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="in-meds">{t('bookings.intake.medications')}</Label>
              <Input id="in-meds" value={form.current_medications} onChange={(e) => setForm({ ...form, current_medications: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="in-history">{t('bookings.intake.history')}</Label>
            <Input id="in-history" value={form.medical_history} onChange={(e) => setForm({ ...form, medical_history: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              {t('bookings.form.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving || !form.symptoms.trim()}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {t('bookings.intake.save')}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setShowForm(true)} disabled={!booking.contact_id}>
          <Plus className="size-3.5" /> {t('bookings.intake.add')}
        </Button>
      )}
    </div>
  )
}
