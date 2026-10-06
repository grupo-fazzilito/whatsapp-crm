'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney } from '@/lib/workspace/countries';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { moneyLocale, invalidateAi } from './shared';

export interface ImportedService {
  name: string;
  description: string;
  category: string;
  price: number;
  price_is_from: boolean;
  duration_minutes: number;
}

export interface ImportedFaq {
  question: string;
  answer: string;
  keywords: string;
}

type Kind = 'services' | 'faqs';
type Item = ImportedService | ImportedFaq;

interface Props {
  kind: Kind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

/**
 * Paste text (or upload a document for FAQs) → AI extracts rows → the
 * admin reviews them → the import route saves the selected ones.
 */
export function BulkImportDialog({ kind, open, onOpenChange, onImported }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, label } = useWorkspace();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'analyze' | 'save' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endpoint = kind === 'services' ? '/api/business/import-services' : '/api/business/import-faqs';
  const noun = kind === 'services' ? label('servicePlural') : t('business.faqs.title');

  const reset = () => {
    setText('');
    setItems(null);
    setSelected(new Set());
  };

  const receive = (list: Item[]) => {
    setItems(list);
    setSelected(new Set(list.map((_, i) => i)));
    if (list.length === 0) toast.info(t('business.import.nothingFound'));
  };

  const analyze = async () => {
    if (!text.trim()) return;
    setBusy('analyze');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('business.import.failed'));
      receive((kind === 'services' ? data.services : data.faqs) ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('business.import.failed'));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('analyze');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/business/import-faqs/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('business.import.failed'));
      receive(data.faqs ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('business.import.failed'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!items) return;
    const chosen = items.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setBusy('save');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: true, items: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('business.import.failed'));
      await invalidateAi();
      toast.success(t('business.import.saved', { count: data.inserted ?? chosen.length }));
      reset();
      onOpenChange(false);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('business.import.failed'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('business.import.title', { items: noun.toLowerCase() })}</DialogTitle>
          <DialogDescription>
            {kind === 'services' ? t('business.import.servicesHint') : t('business.import.faqsHint')}
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div className="grid gap-3">
            <Textarea
              rows={10}
              value={text}
              maxLength={30000}
              aria-label={t('business.import.pasteLabel')}
              placeholder={kind === 'services' ? t('business.import.servicesPlaceholder') : t('business.import.faqsPlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
            {kind === 'faqs' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".docx,.xlsx,.xls,.txt,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f);
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                  <FileUp className="size-3.5" />
                  {t('business.import.uploadFile')}
                </Button>
                {t('business.import.fileTypes')}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{t('business.import.review', { count: items.length })}</p>
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {items.map((it, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                    <input type="checkbox" className="mt-1 size-4 accent-primary" checked={selected.has(i)} onChange={() => toggle(i)} />
                    {'question' in it ? (
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium text-foreground">{it.question}</span>
                        <span className="block text-muted-foreground">{it.answer}</span>
                        {it.keywords && <span className="block text-xs text-muted-foreground/80">{it.keywords}</span>}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="flex justify-between gap-2">
                          <span className="font-medium text-foreground">{it.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {it.price > 0 && workspace
                              ? `${it.price_is_from ? `${t('business.services.from')} ` : ''}${formatMoney(it.price, workspace.currency, moneyLocale(locale, workspace.country))}`
                              : ''}
                            {it.duration_minutes ? ` · ${it.duration_minutes} min` : ''}
                          </span>
                        </span>
                        {it.description && <span className="block text-muted-foreground">{it.description}</span>}
                        {it.category && <span className="block text-xs text-muted-foreground/80">{it.category}</span>}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {items === null ? (
            <Button type="button" onClick={analyze} disabled={!text.trim() || !!busy}>
              {busy === 'analyze' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {t('business.import.analyze')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setItems(null)} disabled={!!busy}>
                {t('business.common.back')}
              </Button>
              <Button type="button" onClick={save} disabled={selected.size === 0 || !!busy}>
                {busy === 'save' && <Loader2 className="size-4 animate-spin" />}
                {t('business.import.saveSelected', { count: selected.size })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
