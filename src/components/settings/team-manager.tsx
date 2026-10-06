'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Mail, Trash2, UserPlus } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/i18n/client';
import type { WorkspaceRole } from '@/lib/workspace/constants';
import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/workspace/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

export function TeamManager() {
  const { can, role: myRole } = useWorkspace();
  const { t, locale } = useI18n();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'agent' | 'admin'>('agent');
  const [inviting, setInviting] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);

  const isAdmin = can('admin');
  const isOwner = can('owner');

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      fetch('/api/workspaces/members').then((r) => r.json()),
      isAdmin ? fetch('/api/workspaces/invitations').then((r) => r.json()) : Promise.resolve({ invitations: [] }),
    ]);
    setMembers(m.members ?? []);
    setMe(m.me?.user_id ?? null);
    setInvitations(i.invitations ?? []);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setShareLink(null);
    try {
      const res = await fetch('/api/workspaces/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t('team.inviteSent', { email }));
      if (data.link) setShareLink(data.link);
      setEmail('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setInviting(false);
    }
  };

  const updateMember = async (memberId: string, patch: { role?: WorkspaceRole; status?: string }) => {
    const res = await fetch('/api/workspaces/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...patch }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? t('common.error'));
    load();
  };

  const removeMember = async (m: WorkspaceMember) => {
    const name = m.profile?.full_name || m.profile?.email || '';
    if (!window.confirm(t('team.confirmRemove', { name }))) return;
    const res = await fetch(`/api/workspaces/members?id=${m.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? t('common.error'));
      return;
    }
    if (m.user_id === me) {
      window.location.href = '/dashboard';
      return;
    }
    load();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/workspaces/invitations?id=${id}`, { method: 'DELETE' });
    load();
  };

  // Which roles the current user may assign to someone else.
  const assignable: WorkspaceRole[] = isOwner ? ['owner', 'admin', 'agent'] : ['agent'];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('team.title')}</CardTitle>
          <CardDescription>{t('team.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                required
                placeholder={t('team.inviteEmail')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="sm:flex-1"
                aria-label={t('team.inviteEmail')}
              />
              <select
                aria-label={t('common.role')}
                className={selectClass}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'agent' | 'admin')}
              >
                <option value="agent">{t('roles.agent')}</option>
                {isOwner && <option value="admin">{t('roles.admin')}</option>}
              </select>
              <Button type="submit" disabled={inviting}>
                {inviting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {t('team.invite')}
              </Button>
            </form>
          )}

          {shareLink && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="mb-2 text-foreground">{t('team.inviteLink')}</p>
              <div className="flex gap-2">
                <Input readOnly value={shareLink} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(shareLink);
                    toast.success(t('common.copied'));
                  }}
                >
                  <Copy className="size-4" />
                  {t('common.copy')}
                </Button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-border rounded-md border border-border">
            {members.map((m) => {
              const isMe = m.user_id === me;
              const canEdit = isAdmin && !isMe && (isOwner || m.role === 'agent');
              const name = m.profile?.full_name || m.profile?.email || '—';
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Avatar className="size-9">
                    {m.profile?.avatar_url ? <AvatarImage src={m.profile.avatar_url} alt={name} /> : null}
                    <AvatarFallback className="bg-primary/10 text-sm text-primary">
                      {name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {name} {isMe && <span className="text-muted-foreground">({t('team.you')})</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.profile?.email}
                      {m.status === 'disabled' && ` · ${t('team.disabled')}`}
                    </p>
                  </div>
                  {canEdit ? (
                    <select
                      aria-label={t('common.role')}
                      className={selectClass}
                      value={m.role}
                      onChange={(e) => updateMember(m.id, { role: e.target.value as WorkspaceRole })}
                    >
                      {(assignable.includes(m.role) ? assignable : [m.role, ...assignable]).map((r) => (
                        <option key={r} value={r}>
                          {t(`roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      {t(`roles.${m.role}`)}
                    </span>
                  )}
                  {(canEdit || (isMe && myRole !== 'owner')) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={isMe ? t('team.leave') : t('common.remove')}
                      onClick={() => removeMember(m)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isAdmin && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('team.pending')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-md border border-border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 p-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`roles.${inv.role}`)} ·{' '}
                      {t('team.expires', { date: new Date(inv.expires_at).toLocaleDateString(locale) })}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={() => revoke(inv.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
