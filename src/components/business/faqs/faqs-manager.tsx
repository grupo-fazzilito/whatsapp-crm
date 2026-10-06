'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bot, FileQuestion, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { EmptyState, LoadingBlock, Notice, PageHeader, invalidateAi, selectClass, type AgentRef, type Faq } from '../shared';
import { BulkImportDialog } from '../bulk-import-dialog';
import { FaqEditor } from './faq-editor';

export function FaqsManager() {
  const t = useT();
  const { workspace, can } = useWorkspace();
  const isAdmin = can('admin');
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [editing, setEditing] = useState<Faq | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    const db = createClient();
    try {
      const [fq, ag] = await Promise.all([
        db.from('faqs').select('id, question, answer, keywords, ai_agent_ids').order('created_at', { ascending: true }),
        db.from('ai_agents').select('id, name').order('created_at', { ascending: true }),
      ]);
      if (fq.error) toast.error(fq.error.message);
      setFaqs((fq.data as Faq[]) ?? []);
      setAgents((ag.data as AgentRef[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs.filter((f) => {
      if (agentFilter && f.ai_agent_ids?.length && !f.ai_agent_ids.includes(agentFilter)) return false;
      if (!q) return true;
      return [f.question, f.answer, f.keywords].some((v) => v?.toLowerCase().includes(q));
    });
  }, [faqs, query, agentFilter]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name;

  const remove = async () => {
    if (!deleting) return;
    const { error } = await createClient().from('faqs').delete().eq('id', deleting.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('business.common.deleted'));
    invalidateAi();
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('business.faqs.title')}
        description={t('business.faqs.description')}
        actions={
          isAdmin && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Sparkles className="size-4" />
                {t('business.import.button')}
              </Button>
              <Button onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                {t('business.faqs.new')}
              </Button>
            </>
          )
        }
      />
      {!isAdmin && <Notice>{t('business.common.readOnly')}</Notice>}

      {loading ? (
        <LoadingBlock />
      ) : faqs.length === 0 ? (
        <EmptyState
          icon={<FileQuestion className="size-6" />}
          title={t('business.faqs.emptyTitle')}
          description={t('business.faqs.emptyDescription')}
          action={
            isAdmin && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Sparkles className="size-4" />
                  {t('business.import.button')}
                </Button>
                <Button onClick={() => setEditing(null)}>
                  <Plus className="size-4" />
                  {t('business.faqs.new')}
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t('business.common.search')}
                aria-label={t('business.common.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {agents.length > 0 && (
              <select
                className={cn(selectClass, 'sm:w-56')}
                aria-label={t('business.faqs.field.agents')}
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">{t('business.faqs.anyAgent')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-3">
            {filtered.map((f) => (
              <Card key={f.id}>
                <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground">{f.question}</h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{f.answer}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(f.keywords ?? '')
                        .split(',')
                        .map((k) => k.trim())
                        .filter(Boolean)
                        .map((k) => (
                          <Badge key={k} variant="outline">
                            {k}
                          </Badge>
                        ))}
                      {f.ai_agent_ids?.length ? (
                        f.ai_agent_ids.map((id) => (
                          <Badge key={id} variant="secondary">
                            <Bot />
                            {agentName(id) ?? t('business.faqs.deletedAgent')}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="secondary">
                          <Bot />
                          {t('business.faqs.allAgents')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={t('business.common.edit')} onClick={() => setEditing(f)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={t('business.common.delete')}
                        onClick={() => setDeleting(f)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t('business.common.noResults')}</p>}
          </div>
        </>
      )}

      {editing !== undefined && (
        <FaqEditor
          faq={editing}
          agents={agents}
          readOnly={!isAdmin}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}

      {isAdmin && <BulkImportDialog kind="faqs" open={importOpen} onOpenChange={setImportOpen} onImported={load} />}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('business.faqs.deleteTitle')}
        description={deleting?.question ?? ''}
        confirmText={t('business.common.delete')}
        cancelText={t('business.common.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}
