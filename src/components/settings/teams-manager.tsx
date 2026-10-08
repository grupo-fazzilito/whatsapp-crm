'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CircleCheck, CircleSlash, Loader2, Pencil, Plus, Shuffle, Trash2, Users } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InboxSettings, Team } from '@/lib/inbox/types';

interface MemberRow {
  user_id: string;
  role: string;
  available: boolean;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  member_ids: string[];
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function TeamsManager() {
  const { workspace, can } = useWorkspace();
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = can('admin');
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [settings, setSettings] = useState<InboxSettings>({ auto_assign: 'off', default_team_id: null });
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toDelete, setToDelete] = useState<Team | null>(null);
  const [busyAvailability, setBusyAvailability] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teams', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setTeams(data.teams ?? []);
      setMembers(data.members ?? []);
      setSettings(data.settings ?? { auto_assign: 'off', default_team_id: null });
    } catch {
      toast.error(t('inboxpro.teams.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspace?.id) void load();
  }, [workspace?.id, load]);

  const nameOf = (m: MemberRow) => m.full_name || m.email;
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  const saveSettings = async (patch: Partial<InboxSettings>) => {
    const before = settings;
    setSettings({ ...settings, ...patch });
    setSavingSettings(true);
    try {
      const res = await fetch('/api/teams/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);
      setSettings(data.settings);
      toast.success(t('inboxpro.teams.autoAssign.saved'));
    } catch {
      setSettings(before);
      toast.error(t('inboxpro.teams.errors.generic'));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(draft.id ? `/api/teams/${draft.id}` : '/api/teams', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, description: draft.description, member_ids: draft.member_ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = data?.error === 'name_taken' || data?.error === 'name_required' ? data.error : 'generic';
        toast.error(t(`inboxpro.teams.errors.${key}`));
        return;
      }
      toast.success(t('inboxpro.teams.saved'));
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async () => {
    if (!toDelete) return;
    const res = await fetch(`/api/teams/${toDelete.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t('inboxpro.teams.deleted'));
      setToDelete(null);
      await load();
    } else {
      toast.error(t('inboxpro.teams.errors.generic'));
    }
  };

  const setMyAvailability = async (available: boolean) => {
    setBusyAvailability(true);
    try {
      const res = await fetch('/api/teams/availability', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available }),
      });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.map((m) => (m.user_id === user?.id ? { ...m, available } : m)));
    } catch {
      toast.error(t('inboxpro.availability.failed'));
    } finally {
      setBusyAvailability(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Auto-assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="size-4 text-primary" aria-hidden="true" />
            {t('inboxpro.teams.autoAssign.title')}
          </CardTitle>
          <CardDescription>{t('inboxpro.teams.autoAssign.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="auto-assign-mode">{t('inboxpro.teams.autoAssign.mode')}</Label>
            <select
              id="auto-assign-mode"
              className={selectClass}
              value={settings.auto_assign}
              disabled={!isAdmin || savingSettings}
              onChange={(e) => void saveSettings({ auto_assign: e.target.value as InboxSettings['auto_assign'] })}
            >
              <option value="off">{t('inboxpro.teams.autoAssign.off')}</option>
              <option value="round_robin">{t('inboxpro.teams.autoAssign.round_robin')}</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="auto-assign-team">{t('inboxpro.teams.autoAssign.defaultTeam')}</Label>
            <select
              id="auto-assign-team"
              className={selectClass}
              value={settings.default_team_id ?? ''}
              disabled={!isAdmin || savingSettings || settings.auto_assign === 'off'}
              onChange={(e) => void saveSettings({ default_team_id: e.target.value || null })}
            >
              <option value="">{t('inboxpro.teams.autoAssign.allMembers')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('inboxpro.teams.autoAssign.help')}</p>
          {!isAdmin && <p className="text-xs text-muted-foreground sm:col-span-2">{t('inboxpro.teams.adminOnly')}</p>}
        </CardContent>
      </Card>

      {/* Teams */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" />
              {t('inboxpro.teams.title')}
            </CardTitle>
            <CardDescription>{t('inboxpro.teams.description')}</CardDescription>
          </div>
          {isAdmin && (
            <Button onClick={() => setDraft({ id: null, name: '', description: '', member_ids: [] })}>
              <Plus className="size-4" aria-hidden="true" />
              {t('inboxpro.teams.new')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('inboxpro.teams.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {teams.map((tm) => {
                const ids = tm.member_ids ?? [];
                const availableCount = ids.filter((id) => memberById.get(id)?.available).length;
                return (
                  <li key={tm.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{tm.name}</p>
                      {tm.description && <p className="text-xs text-muted-foreground">{tm.description}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('inboxpro.teams.memberCount', { n: ids.length })} ·{' '}
                        {t('inboxpro.teams.availableCount', { n: availableCount })}
                      </p>
                      {ids.length > 0 && (
                        <p className="mt-1 text-xs text-foreground">
                          {ids.map((id) => (memberById.get(id) ? nameOf(memberById.get(id)!) : '—')).join(', ')}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t('inboxpro.teams.edit')}: ${tm.name}`}
                          onClick={() =>
                            setDraft({ id: tm.id, name: tm.name, description: tm.description ?? '', member_ids: ids })
                          }
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t('inboxpro.teams.delete')}: ${tm.name}`}
                          onClick={() => setToDelete(tm)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Availability */}
      <Card>
        <CardHeader>
          <CardTitle>{t('inboxpro.teams.availability.title')}</CardTitle>
          <CardDescription>{t('inboxpro.teams.availability.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const me = m.user_id === user?.id;
              return (
                <li key={m.user_id} className="flex items-center gap-3 py-2">
                  <Avatar className="size-8">
                    {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
                    <AvatarFallback className="text-xs">{initials(nameOf(m))}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {nameOf(m)} {me && <span className="text-muted-foreground">{t('inboxpro.transfer.you')}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  {me ? (
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      {m.available ? t('inboxpro.teams.availability.available') : t('inboxpro.teams.availability.away')}
                      <Switch
                        checked={m.available}
                        disabled={busyAvailability}
                        onCheckedChange={(v) => void setMyAvailability(v === true)}
                        aria-label={t('inboxpro.availability.label')}
                      />
                    </label>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {m.available ? (
                        <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <CircleSlash className="size-3.5" aria-hidden="true" />
                      )}
                      {m.available ? t('inboxpro.teams.availability.available') : t('inboxpro.teams.availability.away')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          {draft && (
            <form onSubmit={saveTeam} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{draft.id ? t('inboxpro.teams.edit') : t('inboxpro.teams.new')}</DialogTitle>
                <DialogDescription>{t('inboxpro.teams.dialogHint')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="team-name">{t('inboxpro.teams.name')}</Label>
                <Input
                  id="team-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                  maxLength={80}
                  placeholder={t('inboxpro.teams.namePlaceholder')}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="team-description">{t('inboxpro.teams.descriptionField')}</Label>
                <Input
                  id="team-description"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  maxLength={300}
                />
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium text-foreground">{t('inboxpro.teams.members')}</legend>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {members.map((m) => (
                    <label key={m.user_id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-accent">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={draft.member_ids.includes(m.user_id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            member_ids: e.target.checked
                              ? [...draft.member_ids, m.user_id]
                              : draft.member_ids.filter((id) => id !== m.user_id),
                          })
                        }
                      />
                      <span className="truncate">{nameOf(m)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {t('inboxpro.teams.cancel')}
                </Button>
                <Button type="submit" disabled={saving || !draft.name.trim()}>
                  {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t('inboxpro.teams.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('inboxpro.teams.delete')}</DialogTitle>
            <DialogDescription>{toDelete ? t('inboxpro.teams.deleteConfirm', { name: toDelete.name }) : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              {t('inboxpro.teams.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void deleteTeam()}>
              {t('inboxpro.teams.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
