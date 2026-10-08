'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PROPERTY_TYPES } from '@/lib/real-estate/leads/types';

export interface TeamOption {
  id: string;
  name: string;
}

export interface MemberOption {
  user_id: string;
  name: string;
}

/** Form state (strings for the inputs). */
export interface RuleDraft {
  id: string | null;
  name: string;
  operation: '' | 'buy' | 'rent';
  /** Comma-separated. */
  zones: string;
  property_types: string[];
  budget_min: string;
  budget_max: string;
  target: 'team' | 'user';
  team_id: string;
  user_id: string;
  active: boolean;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export function RuleFormDialog({
  draft: initial,
  onClose,
  onSaved,
  teams,
  members,
}: {
  draft: RuleDraft | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  teams: TeamOption[];
  members: MemberOption[];
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RuleDraft | null>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    const body = {
      name: draft.name,
      active: draft.active,
      conditions: {
        operation: draft.operation || null,
        zones: draft.zones.split(',').map((z) => z.trim()).filter(Boolean),
        property_types: draft.property_types,
        budget_min: num(draft.budget_min),
        budget_max: num(draft.budget_max),
      },
      ...(draft.target === 'team' ? { team_id: draft.team_id, user_id: null } : { user_id: draft.user_id, team_id: null }),
    };
    setSaving(true);
    try {
      const res = await fetch(draft.id ? `/api/real-estate/routing-rules/${draft.id}` : '/api/real-estate/routing-rules', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const known = ['name_required', 'target_required', 'invalid_team', 'invalid_member'];
        toast.error(t(`leads.routing.errors.${known.includes(data?.error) ? data.error : 'generic'}`));
        return;
      }
      toast.success(t('leads.routing.saved'));
      onClose();
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const targetMissing = !draft || (draft.target === 'team' ? !draft.team_id : !draft.user_id);

  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {draft && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{draft.id ? t('leads.routing.edit') : t('leads.routing.new')}</DialogTitle>
              <DialogDescription>{t('leads.routing.dialogHint')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="rule-name">{t('leads.routing.name')}</Label>
              <Input
                id="rule-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                maxLength={120}
                placeholder={t('leads.routing.namePlaceholder')}
              />
            </div>

            <fieldset className="grid gap-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-foreground">{t('leads.routing.conditions')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-operation">{t('leads.fields.operation')}</Label>
                  <select
                    id="rule-operation"
                    className={selectClass}
                    value={draft.operation}
                    onChange={(e) => setDraft({ ...draft, operation: e.target.value as RuleDraft['operation'] })}
                  >
                    <option value="">{t('leads.routing.any')}</option>
                    <option value="buy">{t('leads.operation.buy')}</option>
                    <option value="rent">{t('leads.operation.rent')}</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-zones">{t('leads.fields.zones')}</Label>
                  <Input
                    id="rule-zones"
                    value={draft.zones}
                    onChange={(e) => setDraft({ ...draft, zones: e.target.value })}
                    placeholder={t('leads.routing.zonesPlaceholder')}
                    aria-describedby="rule-zones-help"
                  />
                  <p id="rule-zones-help" className="text-xs text-muted-foreground">
                    {t('leads.routing.zonesHelp')}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-bmin">{t('leads.fields.budgetMin')}</Label>
                  <Input
                    id="rule-bmin"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={draft.budget_min}
                    onChange={(e) => setDraft({ ...draft, budget_min: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-bmax">{t('leads.fields.budgetMax')}</Label>
                  <Input
                    id="rule-bmax"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={draft.budget_max}
                    onChange={(e) => setDraft({ ...draft, budget_max: e.target.value })}
                  />
                </div>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium text-foreground">{t('leads.fields.propertyTypes')}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {PROPERTY_TYPES.map((pt) => (
                    <label key={pt} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={draft.property_types.includes(pt)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            property_types: e.target.checked ? [...draft.property_types, pt] : draft.property_types.filter((x) => x !== pt),
                          })
                        }
                      />
                      {t(`leads.propertyType.${pt}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">{t('leads.routing.conditionsHelp')}</p>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-foreground">{t('leads.routing.assignTo')}</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="rule-target"
                    className="size-4 accent-[var(--primary)]"
                    checked={draft.target === 'team'}
                    onChange={() => setDraft({ ...draft, target: 'team' })}
                  />
                  {t('leads.routing.targetTeam')}
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="rule-target"
                    className="size-4 accent-[var(--primary)]"
                    checked={draft.target === 'user'}
                    onChange={() => setDraft({ ...draft, target: 'user' })}
                  />
                  {t('leads.routing.targetMember')}
                </label>
              </div>
              {draft.target === 'team' ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-team">{t('leads.routing.team')}</Label>
                  <select id="rule-team" className={selectClass} value={draft.team_id} onChange={(e) => setDraft({ ...draft, team_id: e.target.value })}>
                    {!teams.length && <option value="">{t('leads.routing.noTeams')}</option>}
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">{t('leads.routing.teamHelp')}</p>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-member">{t('leads.routing.member')}</Label>
                  <select id="rule-member" className={selectClass} value={draft.user_id} onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </fieldset>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v === true })} aria-label={t('leads.routing.active')} />
              {t('leads.routing.active')}
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('leads.common.cancel')}
              </Button>
              <Button type="submit" disabled={saving || !draft.name.trim() || targetMissing}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t('leads.common.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
