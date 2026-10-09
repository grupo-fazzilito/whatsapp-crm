'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TagsInput } from './tags-input';
import { AGENT_MODELS, AGENT_SKILLS, AGENT_TONES, EMPTY_AGENT, type AgentDraft, type AgentSkill, type AiAgent } from './types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

interface Props {
  /** null = create a new agent. */
  agent: AiAgent | null;
  /** Every agent of the workspace (for the transfer targets). */
  allAgents: AiAgent[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (agent: AiAgent) => void;
}

function toDraft(a: AiAgent | null): AgentDraft {
  if (!a) return { ...EMPTY_AGENT, skills: [...EMPTY_AGENT.skills], escalation_keywords: [...EMPTY_AGENT.escalation_keywords] };
  return {
    name: a.name,
    description: a.description ?? '',
    persona: a.persona ?? '',
    tone: a.tone,
    instructions: a.instructions ?? '',
    language: a.language,
    skills: [...a.skills],
    greeting_message: a.greeting_message ?? '',
    after_hours_message: a.after_hours_message ?? '',
    escalation_keywords: [...a.escalation_keywords],
    business_hours_only: a.business_hours_only,
    enabled: a.enabled,
    transfer_agent_ids: [...(a.transfer_agent_ids ?? [])],
    model: a.model ?? null,
  };
}

const nullIfEmpty = (s: string | null) => (s && s.trim() ? s.trim() : null);

export function AgentEditor({ agent, allAgents, readOnly, onClose, onSaved }: Props) {
  const t = useT();
  const { modules } = useWorkspace();
  const [draft, setDraft] = useState<AgentDraft>(() => toDraft(agent));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const others = allAgents.filter((a) => a.id !== agent?.id);
  const isRouter = draft.skills.includes('router');

  // Skills that depend on a workspace module stay hidden when it's off.
  const skillVisible = (s: AgentSkill) =>
    (s !== 'bookings' || modules.bookings) && (s !== 'catalog' || modules.products) && (s !== 'orders' || modules.orders);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const row = {
      name: draft.name.trim(),
      description: nullIfEmpty(draft.description),
      persona: nullIfEmpty(draft.persona),
      tone: draft.tone,
      instructions: nullIfEmpty(draft.instructions),
      language: draft.language,
      skills: draft.skills,
      greeting_message: nullIfEmpty(draft.greeting_message),
      after_hours_message: nullIfEmpty(draft.after_hours_message),
      escalation_keywords: draft.escalation_keywords,
      business_hours_only: draft.business_hours_only,
      enabled: draft.enabled,
      model: draft.model || null,
      // Drop ids of agents deleted meanwhile.
      transfer_agent_ids: draft.transfer_agent_ids.filter((id) => others.some((a) => a.id === id)),
    };
    if (!row.name) return;
    setSaving(true);
    let data: AiAgent | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(agent ? `/api/agents/${agent.id}` : '/api/agents', {
        method: agent ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) data = (body.agent as AiAgent) ?? null;
      else error = body.error ?? `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : null;
    }
    setSaving(false);
    if (error || !data) {
      toast.error(error ?? t('common.error'));
      return;
    }
    toast.success(agent ? t('agents.saved') : t('agents.created', { name: row.name }));
    onSaved(data as AiAgent);
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full! overflow-y-auto sm:max-w-xl!">
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{agent ? t('agents.editTitle', { name: agent.name }) : t('agents.newTitle')}</SheetTitle>
            <SheetDescription>{t('agents.editorDescription')}</SheetDescription>
          </SheetHeader>

          <fieldset disabled={readOnly} className="grid flex-1 gap-4 px-4 pb-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="ag-name">{t('agents.field.name')}</Label>
                <Input id="ag-name" required maxLength={80} value={draft.name} placeholder={t('agents.field.namePlaceholder')} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="flex items-end gap-2 pb-1.5">
                <Switch id="ag-enabled" checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} />
                <Label htmlFor="ag-enabled">{t('agents.field.enabled')}</Label>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-description">{t('routing.agent.description')}</Label>
              <Textarea
                id="ag-description"
                rows={2}
                maxLength={500}
                value={draft.description ?? ''}
                placeholder={t('routing.agent.descriptionPlaceholder')}
                onChange={(e) => set('description', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('routing.agent.descriptionHelp')}</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-persona">{t('agents.field.persona')}</Label>
              <Textarea id="ag-persona" rows={3} maxLength={2000} value={draft.persona ?? ''} placeholder={t('agents.field.personaPlaceholder')} onChange={(e) => set('persona', e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ag-tone">{t('agents.field.tone')}</Label>
                <select id="ag-tone" className={selectClass} value={draft.tone} onChange={(e) => set('tone', e.target.value)}>
                  {AGENT_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`agents.tone.${tone}`)}
                    </option>
                  ))}
                  {!(AGENT_TONES as readonly string[]).includes(draft.tone) && <option value={draft.tone}>{draft.tone}</option>}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ag-lang">{t('agents.field.language')}</Label>
                <select id="ag-lang" className={selectClass} value={draft.language} onChange={(e) => set('language', e.target.value as AgentDraft['language'])}>
                  <option value="auto">{t('agents.language.auto')}</option>
                  <option value="es">{t('agents.language.es')}</option>
                  <option value="en">{t('agents.language.en')}</option>
                </select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-model">{t('routing.agent.model')}</Label>
              <select id="ag-model" className={selectClass} value={draft.model ?? ''} onChange={(e) => set('model', e.target.value || null)}>
                <option value="">{t('routing.agent.modelAuto')}</option>
                {AGENT_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
                {draft.model && !AGENT_MODELS.some((m) => m.value === draft.model) && <option value={draft.model}>{draft.model}</option>}
              </select>
              <p className="text-xs text-muted-foreground">{t('routing.agent.modelHelp')}</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-instructions">{t('agents.field.instructions')}</Label>
              <Textarea
                id="ag-instructions"
                rows={9}
                maxLength={8000}
                value={draft.instructions ?? ''}
                placeholder={t('agents.field.instructionsPlaceholder')}
                onChange={(e) => set('instructions', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('agents.field.instructionsHelp')}</p>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('agents.field.skills')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {AGENT_SKILLS.filter(skillVisible).map((s) => (
                  <label key={s} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                      checked={draft.skills.includes(s)}
                      onChange={(e) => set('skills', e.target.checked ? [...draft.skills, s] : draft.skills.filter((x) => x !== s))}
                    />
                    <span>
                      <span className="block font-medium text-foreground">{t(`agents.skill.${s}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`agents.skillHint.${s}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('routing.agent.transferTo')}</legend>
              {others.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('routing.agent.noOtherAgents')}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {others.map((a) => (
                    <label key={a.id} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[var(--primary)]"
                        checked={draft.transfer_agent_ids.includes(a.id)}
                        onChange={(e) =>
                          set(
                            'transfer_agent_ids',
                            e.target.checked ? [...draft.transfer_agent_ids, a.id] : draft.transfer_agent_ids.filter((x) => x !== a.id),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">
                          {a.name}
                          {!a.enabled && <span className="font-normal text-muted-foreground"> ({t('routing.agent.disabledSuffix')})</span>}
                        </span>
                        <span className="line-clamp-2 block text-xs text-muted-foreground">
                          {a.description || t('routing.agent.noDescription')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('routing.agent.transferToHelp')} {isRouter ? t('routing.agent.transferToHelpRouter') : t('routing.agent.transferToHelpNone')}
              </p>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-greeting">{t('agents.field.greeting')}</Label>
              <Textarea id="ag-greeting" rows={2} maxLength={1000} value={draft.greeting_message ?? ''} placeholder={t('agents.field.greetingPlaceholder')} onChange={(e) => set('greeting_message', e.target.value)} />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div>
                <Label htmlFor="ag-bho">{t('agents.field.businessHoursOnly')}</Label>
                <p className="text-xs text-muted-foreground">{t('agents.field.businessHoursOnlyHelp')}</p>
              </div>
              <Switch id="ag-bho" checked={draft.business_hours_only} onCheckedChange={(v) => set('business_hours_only', v)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-afterhours">{t('agents.field.afterHours')}</Label>
              <Textarea id="ag-afterhours" rows={2} maxLength={1000} value={draft.after_hours_message ?? ''} placeholder={t('agents.field.afterHoursPlaceholder')} onChange={(e) => set('after_hours_message', e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ag-keywords">{t('agents.field.escalation')}</Label>
              <TagsInput
                id="ag-keywords"
                value={draft.escalation_keywords}
                onChange={(v) => set('escalation_keywords', v)}
                placeholder={t('agents.field.escalationPlaceholder')}
                disabled={readOnly}
                removeLabel={t('common.remove')}
              />
              <p className="text-xs text-muted-foreground">{t('agents.field.escalationHelp')}</p>
            </div>
          </fieldset>

          <SheetFooter className="sticky bottom-0 flex-row justify-end gap-2 border-t border-border bg-popover">
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('agents.close') : t('common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving || !draft.name.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {agent ? t('common.save') : t('common.create')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
