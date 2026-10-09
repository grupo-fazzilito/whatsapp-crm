'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trimOrNull, type AgentRef, type Faq } from '../shared';

interface Props {
  faq: Faq | null;
  agents: AgentRef[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function FaqEditor({ faq, agents, readOnly, onClose, onSaved }: Props) {
  const t = useT();
  const { workspace } = useWorkspace();
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [keywords, setKeywords] = useState(faq?.keywords ?? '');
  // Empty = available to every agent.
  const [agentIds, setAgentIds] = useState<string[]>(faq?.ai_agent_ids ?? []);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !workspace) return;
    if (!question.trim() || !answer.trim()) {
      toast.error(t('business.faqs.required'));
      return;
    }
    setSaving(true);
    const row = {
      question: question.trim(),
      answer: answer.trim(),
      keywords: trimOrNull(
        keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .join(', '),
      ),
      ai_agent_ids: agentIds.length ? agentIds : null,
    };
    try {
      // The server drops the AI's cached business context.
      if (faq) await api(`/api/business/faqs/${faq.id}`, { method: 'PATCH', body: row });
      else await api('/api/business/faqs', { method: 'POST', body: row });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaving(false);
    toast.success(t('business.common.saved'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{faq ? (readOnly ? t('business.faqs.viewTitle') : t('business.faqs.editTitle')) : t('business.faqs.newTitle')}</DialogTitle>
            <DialogDescription>{t('business.faqs.editorDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="fq-q">{t('business.faqs.field.question')}</Label>
            <Input id="fq-q" required maxLength={300} value={question} disabled={readOnly} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fq-a">{t('business.faqs.field.answer')}</Label>
            <Textarea id="fq-a" required rows={5} maxLength={2000} value={answer} disabled={readOnly} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fq-k">{t('business.faqs.field.keywords')}</Label>
            <Input
              id="fq-k"
              maxLength={300}
              placeholder={t('business.faqs.field.keywordsPlaceholder')}
              value={keywords}
              disabled={readOnly}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">{t('business.faqs.field.agents')}</legend>
            <p className="text-xs text-muted-foreground">{t('business.faqs.field.agentsHint')}</p>
            {agents.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('business.faqs.noAgents')}</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={agentIds.includes(a.id)}
                      disabled={readOnly}
                      onChange={(e) => setAgentIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                    />
                    <span className="truncate text-foreground">{a.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('business.common.close') : t('business.common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('business.common.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
