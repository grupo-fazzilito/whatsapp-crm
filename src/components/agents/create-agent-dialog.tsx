'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, CalendarCheck, Headphones, Loader2, PenLine, ShoppingBag, Split } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { agentFromTemplate, templatesFor, type TemplateKey } from '@/lib/agents/templates';

const ICONS: Record<TemplateKey, typeof Headphones> = {
  receptionist: CalendarCheck,
  sales: ShoppingBag,
  real_estate: Building2,
  support: Headphones,
  router: Split,
  blank: PenLine,
};

/** "New agent" menu: pick a template, the agent is created and opened on its training tab. */
export function CreateAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const { workspace, modules } = useWorkspace();
  const router = useRouter();
  const [creating, setCreating] = useState<TemplateKey | null>(null);
  const lang = locale === 'en' ? 'en' : 'es';
  const options = templatesFor(workspace?.industry, { bookings: modules.bookings, products: modules.products, orders: modules.orders });

  const create = async (key: TemplateKey) => {
    const tpl = options.find((o) => o.key === key);
    if (!tpl || creating) return;
    setCreating(key);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentFromTemplate(tpl, lang, { bookings: modules.bookings, products: modules.products, orders: modules.orders })),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.agent?.id) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(t('agents.created', { name: body.agent.name ?? '' }));
      onOpenChange(false);
      router.push(`/agents/${body.agent.id}?tab=training&template=${key}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCreating(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('agents.create.title')}</DialogTitle>
          <DialogDescription>{t('agents.create.description')}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('agents.create.title')}>
          {options.map((o) => {
            const Icon = ICONS[o.key];
            const description = o.key === 'blank' ? t('agents.create.blankDescription') : o.text[lang].description;
            return (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => create(o.key)}
                  disabled={!!creating}
                  className={cn(
                    'flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                    creating === o.key && 'border-primary',
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                    {creating === o.key ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{t(`agents.create.templates.${o.key}`)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
                    {o.key !== 'blank' && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {o.skills
                          .filter((s) => (s !== 'bookings' || modules.bookings) && (s !== 'catalog' || modules.products) && (s !== 'orders' || modules.orders))
                          .map((s) => (
                            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {t(`agents.skill.${s}`)}
                            </span>
                          ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
