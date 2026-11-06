'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, ExternalLink, Loader2, Megaphone, Pencil, Play, Plus, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/business/shared';
import type { SocialAccountView, PostView } from '@/lib/social/server';
import type { PostStatus, Target } from '@/lib/social/model';
import { ConnectCard } from './connect-card';
import { PostEditor } from './post-editor';
import { PostsSettings } from './posts-settings';

type Tab = 'upcoming' | 'approval' | 'published' | 'settings';

const TAB_STATUSES: Record<Exclude<Tab, 'settings'>, PostStatus[]> = {
  upcoming: ['draft', 'scheduled', 'publishing'],
  approval: ['pending_approval'],
  published: ['published', 'partial', 'failed', 'cancelled'],
};

export interface AccountsState {
  accounts: SocialAccountView[];
  available: boolean;
}

const STATUS_TONE: Record<PostStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  scheduled: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  publishing: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
};

/** Simple single-colour glyphs (no brand assets shipped). */
export function TargetIcon({ target, className = 'size-3.5' }: { target: Target; className?: string }) {
  const common = { viewBox: '0 0 24 24', className, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (target === 'facebook')
    return (
      <svg {...common}>
        <path d="M15 3.5h-2.5A3.5 3.5 0 0 0 9 7v3H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7.5a1 1 0 0 1 1-1H15z" />
      </svg>
    );
  if (target === 'instagram')
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z" />
      <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.8-2.8l.8-1-1-2z" fill="currentColor" strokeWidth={0.5} />
    </svg>
  );
}

export function PostsManager() {
  const t = useT();
  const { locale } = useI18n();
  const { can } = useWorkspace();
  const admin = can('admin');
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [approvalCount, setApprovalCount] = useState(0);
  const [accounts, setAccounts] = useState<AccountsState | null>(null);
  const [editing, setEditing] = useState<PostView | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/social/accounts', { cache: 'no-store' }).catch(() => null);
    setAccounts(res?.ok ? ((await res.json()) as AccountsState) : { accounts: [], available: false });
  }, []);

  const load = useCallback(async (which: Tab) => {
    const approval = await fetch('/api/social/posts?status=pending_approval', { cache: 'no-store' }).catch(() => null);
    if (approval?.ok) setApprovalCount(((await approval.json()) as { posts: PostView[] }).posts.length);
    if (which === 'settings') return;
    const res = await fetch(`/api/social/posts?status=${TAB_STATUSES[which].join(',')}`, { cache: 'no-store' }).catch(() => null);
    setPosts(res?.ok ? ((await res.json()) as { posts: PostView[] }).posts : []);
  }, []);

  useEffect(() => {
     
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
     
    setPosts(null);
    void load(tab);
  }, [load, tab]);

  // Back from Facebook Login (?connect=ok|error|pick) or a notification (?post=id).
  const connect = params.get('connect');
  const reason = params.get('reason');
  const openPost = params.get('post');
  useEffect(() => {
    if (connect === 'ok') toast.success(t('posts.connect.connected'));
    if (connect === 'error') toast.error(t(`posts.connect.error.${reason ?? 'exchange'}`));
    if (openPost) {
      void fetch(`/api/social/posts/${openPost}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { post: PostView } | null) => {
          if (!b?.post) return;
           
          setTab(b.post.status === 'pending_approval' ? 'approval' : TAB_STATUSES.published.includes(b.post.status) ? 'published' : 'upcoming');
          if (admin && ['draft', 'pending_approval', 'scheduled', 'failed'].includes(b.post.status)) setEditing(b.post);
        });
    }
    if ((connect && connect !== 'pick') || openPost) router.replace('/posts');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [connect, openPost]);

  const fmtDay = useCallback(
    (iso: string | null) => {
      if (!iso) return t('posts.noDate');
      const d = new Date(iso);
      const today = new Date();
      const tomorrow = new Date(Date.now() + 86_400_000);
      if (d.toDateString() === today.toDateString()) return t('posts.today');
      if (d.toDateString() === tomorrow.toDateString()) return t('posts.tomorrow');
      return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    },
    [locale, t],
  );
  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-PE', { hour: '2-digit', minute: '2-digit' }) : '');

  const groups = useMemo(() => {
    if (!posts) return null;
    const sorted = tab === 'published' ? posts : [...posts].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
    const map = new Map<string, PostView[]>();
    for (const p of sorted) {
      const key = fmtDay(tab === 'published' ? (p.published_at ?? p.scheduled_at ?? p.created_at) : p.scheduled_at);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [posts, tab, fmtDay]);

  const reasonText = (r: string | null | undefined) => {
    if (!r) return '';
    const key = `posts.reason.${r}`;
    const s = t(key);
    return s === key ? r : s;
  };

  const act = async (p: PostView, action: 'approve' | 'publish_now' | 'retry' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(t('posts.actions.cancelConfirm'))) return;
    setBusy(p.id);
    const res = await fetch(`/api/social/posts/${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) {
      toast.error(errorText(t, body));
      return;
    }
    toast.success(action === 'cancel' ? t('posts.toasts.cancelled') : action === 'approve' ? t('posts.toasts.approved') : t('posts.toasts.publishing'));
    void load(tab);
    if (action !== 'cancel') setTimeout(() => void load(tab), 8000);
  };

  const remove = async (p: PostView) => {
    if (!window.confirm(t('posts.actions.deleteConfirm'))) return;
    setBusy(p.id);
    const res = await fetch(`/api/social/posts/${p.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('posts.toasts.deleted'));
      setPosts((ps) => (ps ?? []).filter((x) => x.id !== p.id));
    } else toast.error(t('posts.errors.generic'));
  };

  const connected = new Set((accounts?.accounts ?? []).filter((a) => a.status === 'active').map((a) => a.network));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('posts.title')}
        description={t('posts.description')}
        actions={
          admin ? (
            <Button type="button" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> {t('posts.new')}
            </Button>
          ) : undefined
        }
      />

      <ConnectCard state={accounts} pick={connect === 'pick'} onChange={loadAccounts} />

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="upcoming" className="px-3">{t('posts.tabs.upcoming')}</TabsTrigger>
            <TabsTrigger value="approval" className="px-3">
              {t('posts.tabs.approval')}
              {approvalCount > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{approvalCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="published" className="px-3">{t('posts.tabs.published')}</TabsTrigger>
            <TabsTrigger value="settings" className="px-3">{t('posts.tabs.settings')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === 'settings' ? (
        <PostsSettings connected={connected} />
      ) : !groups ? (
        <LoadingBlock />
      ) : groups.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-6" />} title={t(`posts.empty.${tab}`)} description={t('posts.emptyHint')} />
      ) : (
        <div className="space-y-6">
          {groups.map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first-letter:uppercase">{day}</h2>
              <ul className="space-y-3">
                {list.map((p) => {
                  const cover = p.media[0];
                  const editable = admin && ['draft', 'pending_approval', 'scheduled', 'failed', 'cancelled'].includes(p.status);
                  return (
                    <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row">
                      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {cover?.type === 'video' ? (
                          <>
                            <video src={cover.url} className="size-full object-cover" muted preload="metadata" />
                            <Play className="absolute inset-0 m-auto size-6 text-white drop-shadow" aria-hidden />
                          </>
                        ) : cover ? (
                          // eslint-disable-next-line @next/next/no-img-element -- user media from storage
                          <img src={cover.url} alt="" className="size-full object-cover" />
                        ) : null}
                        {p.media.length > 1 && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">+{p.media.length - 1}</span>}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_TONE[p.status]}`}>{t(`posts.status.${p.status}`)}</span>
                          <Badge variant="outline" className="font-normal">{t(`posts.format.${p.format}`)}</Badge>
                          {p.origin !== 'manual' && <Badge variant="secondary" className="font-normal">{t(`posts.origin.${p.origin}`)}</Badge>}
                          {p.scheduled_at && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <CalendarClock className="size-3.5" aria-hidden /> {fmtTime(p.scheduled_at)}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground" aria-label={p.targets.map((x) => t(`posts.target.${x}`)).join(', ')}>
                            {p.targets.map((x) => (
                              <span key={x} title={t(`posts.target.${x}`)} className={connected.has(x as 'facebook' | 'instagram') || x === 'whatsapp_status' ? '' : 'opacity-40'}>
                                <TargetIcon target={x} />
                              </span>
                            ))}
                          </span>
                        </div>
                        {p.product_name && <p className="text-xs text-muted-foreground">{t('posts.editor.product', { name: p.product_name })}</p>}
                        <p className="line-clamp-3 whitespace-pre-line break-words text-sm text-foreground">{p.caption || '—'}</p>
                        {Object.keys(p.results).length > 0 && (
                          <ul className="space-y-0.5 text-xs">
                            {p.targets.map((x) => {
                              const r = p.results[x];
                              if (!r) return null;
                              return (
                                <li key={x} className="flex flex-wrap items-center gap-1.5">
                                  {r.status === 'published' || r.status === 'sent' ? (
                                    <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
                                  ) : r.status === 'processing' ? (
                                    <Loader2 className="size-3.5 animate-spin text-sky-500" aria-hidden />
                                  ) : (
                                    <XCircle className="size-3.5 text-red-500" aria-hidden />
                                  )}
                                  <span className="font-medium">{t(`posts.target.${x}`)}</span>
                                  {r.status === 'failed' && <span className="text-red-600 dark:text-red-400">· {reasonText(r.error)}</span>}
                                  {r.status === 'processing' && <span className="text-muted-foreground">· {reasonText('instagram_video_processing')}</span>}
                                  {r.url && x !== 'whatsapp_status' && (
                                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline">
                                      {t('posts.actions.open', { network: t(`posts.target.${x}`) })} <ExternalLink className="size-3" aria-hidden />
                                    </a>
                                  )}
                                  {x === 'whatsapp_status' && (
                                    <a href={`/estado/${p.share_token}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline">
                                      {t('posts.actions.statusPage')} <ExternalLink className="size-3" aria-hidden />
                                    </a>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      {admin && (
                        <div className="flex flex-wrap items-start gap-1.5 sm:w-44 sm:flex-col sm:items-stretch">
                          {p.status === 'pending_approval' && (
                            <Button type="button" size="sm" disabled={busy === p.id} onClick={() => void act(p, 'approve')}>
                              <CheckCircle2 className="size-4" aria-hidden /> {t('posts.actions.approve')}
                            </Button>
                          )}
                          {['draft', 'pending_approval', 'scheduled'].includes(p.status) && (
                            <Button type="button" size="sm" variant={p.status === 'pending_approval' ? 'outline' : 'default'} disabled={busy === p.id} onClick={() => void act(p, 'publish_now')}>
                              <Send className="size-4" aria-hidden /> {t('posts.actions.publishNow')}
                            </Button>
                          )}
                          {(p.status === 'failed' || p.status === 'partial') && (
                            <Button type="button" size="sm" disabled={busy === p.id} onClick={() => void act(p, 'retry')}>
                              <RotateCcw className="size-4" aria-hidden /> {t('posts.actions.retry')}
                            </Button>
                          )}
                          {editable && (
                            <Button type="button" size="sm" variant="outline" disabled={busy === p.id} onClick={() => setEditing(p)}>
                              <Pencil className="size-4" aria-hidden /> {t('posts.actions.edit')}
                            </Button>
                          )}
                          {['draft', 'pending_approval', 'scheduled'].includes(p.status) && (
                            <Button type="button" size="sm" variant="ghost" disabled={busy === p.id} onClick={() => void act(p, 'cancel')}>
                              <XCircle className="size-4" aria-hidden /> {t('posts.actions.cancel')}
                            </Button>
                          )}
                          {p.status !== 'publishing' && (
                            <Button type="button" size="sm" variant="ghost" className="text-red-600 hover:text-red-700 dark:text-red-400" disabled={busy === p.id} onClick={() => void remove(p)}>
                              {busy === p.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} {t('posts.actions.delete')}
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <PostEditor
          post={editing === 'new' ? null : editing}
          connected={connected}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            const next: Tab = p.status === 'pending_approval' ? 'approval' : TAB_STATUSES.published.includes(p.status) ? 'published' : 'upcoming';
            if (next !== tab) setTab(next);
            else void load(tab);
            if (p.status === 'scheduled' && p.scheduled_at && new Date(p.scheduled_at).getTime() <= Date.now() + 60_000) setTimeout(() => void load(next), 8000);
          }}
        />
      )}
    </div>
  );
}

export function errorText(t: (k: string, v?: Record<string, string | number>) => string, body: unknown): string {
  const b = (body ?? {}) as { error?: string; issues?: string[]; targets?: string[] };
  if (b.error === 'issues' && b.issues?.length) return b.issues.map((i) => t(`posts.issues.${i}`)).join(' ');
  if (b.error === 'not_connected') return t('posts.errors.not_connected', { targets: (b.targets ?? []).map((x) => t(`posts.target.${x}`)).join(', ') });
  if (b.error === 'no_credits' || b.error === 'no_provider' || b.error === 'not_editable') return t(`posts.errors.${b.error}`);
  return t('posts.errors.generic');
}
