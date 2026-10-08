'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Route, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import type { RoutingRule } from '@/lib/real-estate/leads/types';
import { RuleFormDialog, type RuleDraft, type TeamOption, type MemberOption } from './rule-form-dialog';

/**
 * "Asignación de leads": ordered routing rules for qualified real-estate
 * leads. The first active rule whose conditions match assigns the
 * conversation to a member, or round robin inside a team.
 */
export function RoutingRulesManager() {
  const { workspace, can } = useWorkspace();
  const { t, locale } = useI18n();
  const isAdmin = can('admin');
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [toDelete, setToDelete] = useState<RoutingRule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, tm] = await Promise.all([
        fetch('/api/real-estate/routing-rules', { cache: 'no-store' }),
        fetch('/api/teams', { cache: 'no-store' }),
      ]);
      const rd = await r.json();
      const td = await tm.json();
      if (!r.ok) throw new Error(rd?.error);
      setRules(rd.rules ?? []);
      setTeams((td.teams ?? []).map((x: TeamOption) => ({ id: x.id, name: x.name })));
      setMembers(
        (td.members ?? []).map((m: { user_id: string; full_name: string; email: string }) => ({ user_id: m.user_id, name: m.full_name || m.email })),
      );
    } catch {
      toast.error(t('leads.routing.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspace?.id) void load();
  }, [workspace?.id, load]);

  const money = (n: number) =>
    formatMoney(n, workspace?.currency || 'PEN', moneyLocale({ locale, country: workspace?.country ?? null }));
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name ?? '—';
  const memberName = (id: string | null) => members.find((x) => x.user_id === id)?.name ?? '—';

  const summary = (r: RoutingRule) => {
    const c = r.conditions ?? {};
    const parts: string[] = [];
    if (c.operation) parts.push(t(`leads.operation.${c.operation}`));
    if (c.zones?.length) parts.push(c.zones.join(', '));
    if (c.property_types?.length) parts.push(c.property_types.map((p) => t(`leads.propertyType.${p}`)).join(', '));
    if (c.budget_min != null && c.budget_max != null) parts.push(`${money(c.budget_min)} – ${money(c.budget_max)}`);
    else if (c.budget_max != null) parts.push(t('leads.routing.upTo', { amount: money(c.budget_max) }));
    else if (c.budget_min != null) parts.push(t('leads.routing.from', { amount: money(c.budget_min) }));
    return parts.length ? parts.join(' · ') : t('leads.routing.anyLead');
  };

  const patchRule = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/real-estate/routing-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  };

  const toggle = async (r: RoutingRule, active: boolean) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, active } : x)));
    try {
      await patchRule(r.id, { active });
    } catch {
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: r.active } : x)));
      toast.error(t('leads.routing.errors.generic'));
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...rules];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    const before = rules;
    setRules(next);
    setBusy(true);
    try {
      const res = await fetch('/api/real-estate/routing-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((x) => x.id) }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('leads.routing.reordered'));
    } catch {
      setRules(before);
      toast.error(t('leads.routing.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    const res = await fetch(`/api/real-estate/routing-rules/${toDelete.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t('leads.routing.deleted'));
      setToDelete(null);
      await load();
    } else {
      toast.error(t('leads.routing.errors.generic'));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">{t('leads.common.loading')}</span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4 text-primary" aria-hidden="true" />
            {t('leads.routing.title')}
          </CardTitle>
          <CardDescription>{t('leads.routing.description')}</CardDescription>
        </div>
        {isAdmin && (
          <Button
            onClick={() =>
              setDraft({
                id: null,
                name: '',
                operation: '',
                zones: '',
                property_types: [],
                budget_min: '',
                budget_max: '',
                target: teams.length ? 'team' : 'user',
                team_id: teams[0]?.id ?? '',
                user_id: members[0]?.user_id ?? '',
                active: true,
              })
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('leads.routing.new')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {!isAdmin && <p className="text-xs text-muted-foreground">{t('leads.routing.adminOnly')}</p>}
        {rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('leads.routing.empty')}</p>
        ) : (
          <ol className="grid gap-2" aria-label={t('leads.routing.listLabel')}>
            {rules.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card p-3">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground tabular-nums"
                  aria-label={t('leads.routing.position', { n: i + 1 })}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t('leads.routing.when')}</span> {summary(r)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t('leads.routing.assignTo')}</span>{' '}
                    {r.team_id ? t('leads.routing.teamTarget', { name: teamName(r.team_id) }) : memberName(r.user_id)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <label className="mr-2 flex items-center gap-2 text-xs text-foreground">
                    {r.active ? t('leads.routing.active') : t('leads.routing.inactive')}
                    <Switch
                      checked={r.active}
                      disabled={!isAdmin}
                      onCheckedChange={(v) => void toggle(r, v === true)}
                      aria-label={`${t('leads.routing.active')}: ${r.name}`}
                    />
                  </label>
                  {isAdmin && (
                    <>
                      <Button variant="ghost" size="icon-sm" disabled={busy || i === 0} onClick={() => void move(i, -1)} aria-label={`${t('leads.routing.moveUp')}: ${r.name}`}>
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || i === rules.length - 1}
                        onClick={() => void move(i, 1)}
                        aria-label={`${t('leads.routing.moveDown')}: ${r.name}`}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t('leads.routing.edit')}: ${r.name}`}
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            name: r.name,
                            operation: r.conditions?.operation ?? '',
                            zones: (r.conditions?.zones ?? []).join(', '),
                            property_types: r.conditions?.property_types ?? [],
                            budget_min: r.conditions?.budget_min != null ? String(r.conditions.budget_min) : '',
                            budget_max: r.conditions?.budget_max != null ? String(r.conditions.budget_max) : '',
                            target: r.team_id ? 'team' : 'user',
                            team_id: r.team_id ?? teams[0]?.id ?? '',
                            user_id: r.user_id ?? members[0]?.user_id ?? '',
                            active: r.active,
                          })
                        }
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${t('leads.routing.delete')}: ${r.name}`} onClick={() => setToDelete(r)}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">{t('leads.routing.help')}</p>
      </CardContent>

      <RuleFormDialog draft={draft} onClose={() => setDraft(null)} onSaved={load} teams={teams} members={members} />

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('leads.routing.delete')}</DialogTitle>
            <DialogDescription>{toDelete ? t('leads.routing.deleteConfirm', { name: toDelete.name }) : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              {t('leads.common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              {t('leads.routing.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
