'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Film, ImageIcon, Loader2, Music, Paperclip, Pencil, Plus, Search, Trash2, X, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, attachmentKind } from '@/lib/channels/capabilities';
import {
  MAX_QUICK_REPLY_ATTACHMENTS,
  QUICK_REPLY_VARIABLES,
  normalizeShortcut,
} from '@/lib/inbox/quick-replies';
import type { QuickReply, QuickReplyAttachment } from '@/lib/inbox/types';

const ICONS = { image: ImageIcon, video: Film, audio: Music, document: FileText } as const;

interface Draft {
  id: string | null;
  shortcut: string;
  title: string;
  body: string;
  attachments: QuickReplyAttachment[];
  is_shared: boolean;
}

const EXAMPLES = [1, 2, 3] as const;

function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'file';
}

export function QuickRepliesManager() {
  const { workspace, can } = useWorkspace();
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = can('admin');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<QuickReply | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Files uploaded while the dialog is open (removed again on cancel).
  const sessionUploads = useRef<string[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setItems(data.quick_replies ?? []);
    } catch {
      toast.error(t('inboxpro.quickReplies.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspace?.id) void load();
  }, [workspace?.id, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.shortcut, i.title, i.body].some((s) => s.toLowerCase().includes(q)));
  }, [items, query]);

  const canManage = (qr: QuickReply) => (qr.is_shared ? isAdmin : qr.created_by === user?.id);

  const openNew = (preset?: Partial<Draft>) => {
    sessionUploads.current = [];
    setDraft({ id: null, shortcut: '', title: '', body: '', attachments: [], is_shared: isAdmin, ...preset });
  };
  const openEdit = (qr: QuickReply) => {
    sessionUploads.current = [];
    setDraft({
      id: qr.id,
      shortcut: qr.shortcut,
      title: qr.title,
      body: qr.body,
      attachments: qr.attachments ?? [],
      is_shared: qr.is_shared,
    });
  };

  const discardUploads = async (keep: QuickReplyAttachment[] = []) => {
    const keepPaths = new Set(keep.map((a) => a.path));
    const orphan = sessionUploads.current.filter((p) => !keepPaths.has(p));
    sessionUploads.current = [];
    if (orphan.length) await createClient().storage.from('attachments').remove(orphan);
  };

  const closeDialog = () => {
    void discardUploads();
    setDraft(null);
  };

  const insertVariable = (v: string) => {
    if (!draft) return;
    const el = bodyRef.current;
    const token = `{${v}}`;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    const body = draft.body.slice(0, start) + token + draft.body.slice(end);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !draft || !workspace) return;
    setUploading(true);
    const added: QuickReplyAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        if (draft.attachments.length + added.length >= MAX_QUICK_REPLY_ATTACHMENTS) {
          toast.error(t('inboxpro.quickReplies.maxAttachments', { n: MAX_QUICK_REPLY_ATTACHMENTS }));
          break;
        }
        const kind = attachmentKind(file.type);
        if (!kind) {
          toast.error(t('inbox.composer.fileTypeNotAllowed'));
          continue;
        }
        if (file.size > ATTACHMENT_MAX_BYTES) {
          toast.error(t('inbox.composer.fileTooLarge', { max: '16 MB' }));
          continue;
        }
        const path = `${workspace.id}/quick-replies/${crypto.randomUUID()}-${safeFileName(file.name)}`;
        const { error } = await createClient()
          .storage.from('attachments')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          toast.error(t('inbox.composer.uploadFailed', { reason: error.message }));
          continue;
        }
        sessionUploads.current.push(path);
        added.push({ path, type: kind, name: file.name.slice(0, 120) });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
    if (added.length) setDraft((d) => (d ? { ...d, attachments: [...d.attachments, ...added] } : d));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        shortcut: draft.shortcut,
        title: draft.title,
        body: draft.body,
        attachments: draft.attachments,
        ...(isAdmin ? { is_shared: draft.is_shared } : {}),
      };
      const res = await fetch(draft.id ? `/api/quick-replies/${draft.id}` : '/api/quick-replies', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = typeof data?.error === 'string' ? data.error : 'generic';
        const msg = t(`inboxpro.quickReplies.errors.${key}`);
        toast.error(msg.startsWith('inboxpro.') ? t('inboxpro.quickReplies.errors.generic') : msg);
        return;
      }
      // Files removed from an existing reply are deleted after the save.
      if (draft.id) {
        const before = items.find((i) => i.id === draft.id)?.attachments ?? [];
        const kept = new Set(draft.attachments.map((a) => a.path));
        const removed = before.map((a) => a.path).filter((p): p is string => !!p && !kept.has(p));
        if (removed.length) await createClient().storage.from('attachments').remove(removed);
      }
      sessionUploads.current = [];
      toast.success(t('inboxpro.quickReplies.saved'));
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/quick-replies/${toDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((i) => i.id !== toDelete.id));
      toast.success(t('inboxpro.quickReplies.deleted'));
      setToDelete(null);
    } catch {
      toast.error(t('inboxpro.quickReplies.errors.generic'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('inboxpro.quickReplies.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('inboxpro.quickReplies.description')}</p>
        </div>
        <Button onClick={() => openNew()}>
          <Plus className="size-4" aria-hidden="true" />
          {t('inboxpro.quickReplies.new')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-primary" aria-hidden="true" />
              {t('inboxpro.quickReplies.empty')}
            </CardTitle>
            <CardDescription>{t('inboxpro.quickReplies.emptyHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 md:grid-cols-3">
              {EXAMPLES.map((n) => {
                const shortcut = t(`inboxpro.quickReplies.examples.e${n}.shortcut`);
                const title = t(`inboxpro.quickReplies.examples.e${n}.title`);
                const body = t(`inboxpro.quickReplies.examples.e${n}.body`);
                return (
                  <li key={n} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <p className="text-sm font-medium text-foreground">
                      <span className="font-mono text-primary">/{shortcut}</span> · {title}
                    </p>
                    <p className="flex-1 whitespace-pre-wrap text-xs text-muted-foreground">{body}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openNew({ shortcut, title, body })}
                      aria-label={t('inboxpro.quickReplies.useExampleFor', { shortcut })}
                    >
                      {t('inboxpro.quickReplies.useExample')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('inboxpro.quickReplies.search')}
                aria-label={t('inboxpro.quickReplies.search')}
                className="pl-8"
              />
            </div>
            <ul className="divide-y divide-border">
              {visible.map((qr) => (
                <li key={qr.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono font-medium text-primary">/{qr.shortcut}</span>
                      <span className="font-medium text-foreground">{qr.title}</span>
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {qr.is_shared ? t('inboxpro.quickReplies.sharedBadge') : t('inboxpro.quickReplies.personal')}
                      </span>
                      {qr.attachments?.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Paperclip className="size-3" aria-hidden="true" />
                          {t('inboxpro.quickReplies.attachmentCount', { n: qr.attachments.length })}
                        </span>
                      )}
                    </p>
                    {qr.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{qr.body}</p>}
                  </div>
                  {canManage(qr) && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(qr)}
                        aria-label={`${t('inboxpro.quickReplies.edit')}: /${qr.shortcut}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setToDelete(qr)}
                        aria-label={`${t('inboxpro.quickReplies.delete')}: /${qr.shortcut}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {visible.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">{t('inboxpro.quickReplies.noMatches')}</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          {draft && (
            <form onSubmit={save} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{draft.id ? t('inboxpro.quickReplies.edit') : t('inboxpro.quickReplies.new')}</DialogTitle>
                <DialogDescription>{t('inboxpro.quickReplies.dialogHint')}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="qr-shortcut">{t('inboxpro.quickReplies.shortcut')}</Label>
                  <div className="flex items-center rounded-lg border border-input focus-within:ring-3 focus-within:ring-ring/50">
                    <span className="pl-2.5 font-mono text-sm text-muted-foreground" aria-hidden="true">/</span>
                    <input
                      id="qr-shortcut"
                      value={draft.shortcut}
                      onChange={(e) => setDraft({ ...draft, shortcut: normalizeShortcut(e.target.value) })}
                      required
                      maxLength={32}
                      aria-describedby="qr-shortcut-hint"
                      className="h-8 min-w-0 flex-1 bg-transparent px-1 font-mono text-sm text-foreground outline-none"
                    />
                  </div>
                  <p id="qr-shortcut-hint" className="text-[11px] text-muted-foreground">
                    {t('inboxpro.quickReplies.shortcutHint')}
                  </p>
                </div>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="qr-title">{t('inboxpro.quickReplies.titleField')}</Label>
                  <Input
                    id="qr-title"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    required
                    maxLength={80}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="qr-body">{t('inboxpro.quickReplies.body')}</Label>
                <Textarea
                  id="qr-body"
                  ref={bodyRef}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={5}
                  maxLength={4096}
                  aria-describedby="qr-body-hint"
                  className="max-h-60"
                />
                <div className="flex flex-wrap items-center gap-1" id="qr-body-hint">
                  <span className="text-[11px] text-muted-foreground">{t('inboxpro.quickReplies.bodyHint')}</span>
                  {QUICK_REPLY_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariable(v)}
                      aria-label={t('inboxpro.quickReplies.insertVariable', { v: `{${v}}` })}
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-1.5">
                <span className="text-sm font-medium text-foreground">{t('inboxpro.quickReplies.attachments')}</span>
                {draft.attachments.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {draft.attachments.map((a, i) => {
                      const Icon = ICONS[a.type] ?? FileText;
                      return (
                        <li key={`${a.path ?? a.url}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border py-1 pl-2 pr-1 text-xs text-foreground">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="max-w-48 truncate">{a.name}</span>
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, attachments: draft.attachments.filter((_, j) => j !== i) })}
                            aria-label={t('inboxpro.composer.removeQuickAttachment', { name: a.name })}
                            className="flex size-5 items-center justify-center rounded hover:bg-accent"
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => void upload(e.target.files)}
                />
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || draft.attachments.length >= MAX_QUICK_REPLY_ATTACHMENTS}
                  >
                    {uploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Paperclip aria-hidden="true" />}
                    {t('inboxpro.quickReplies.addAttachment')}
                  </Button>
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={draft.is_shared}
                  disabled={!isAdmin}
                  onChange={(e) => setDraft({ ...draft, is_shared: e.target.checked })}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                />
                <span>
                  {t('inboxpro.quickReplies.shared')}
                  {!isAdmin && (
                    <span className="block text-xs text-muted-foreground">{t('inboxpro.quickReplies.sharedHint')}</span>
                  )}
                </span>
              </label>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t('inboxpro.quickReplies.cancel')}
                </Button>
                <Button type="submit" disabled={saving || uploading || !draft.shortcut || !draft.title.trim()}>
                  {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t('inboxpro.quickReplies.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('inboxpro.quickReplies.delete')}</DialogTitle>
            <DialogDescription>
              {toDelete ? t('inboxpro.quickReplies.deleteConfirm', { shortcut: toDelete.shortcut }) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              {t('inboxpro.quickReplies.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('inboxpro.quickReplies.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
