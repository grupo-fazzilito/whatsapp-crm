'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Bot, List, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { WelcomeMenu, WelcomeMenuOption } from '@/lib/ai/types';
import { apiJson, selectClass, type AgentOption, type ChannelDTO } from './channel-types';

// Mirrors src/app/api/channels/_lib/welcome-menu.ts (server re-validates).
const MAX_OPTIONS = 10;
const MAX_BUTTONS = 3;
const BUTTON_TITLE = 20;
const LIST_TITLE = 24;
const DESCRIPTION = 72;
const HUMAN = '__human__';

interface Member {
  user_id: string;
  name: string;
}

interface OptionForm {
  /** Stable id once saved; new options get one from their label on save. */
  id: string;
  label: string;
  description: string;
  /** Agent id, or HUMAN. */
  target: string;
  assignee: string;
}

export function readWelcomeMenu(settings: Record<string, unknown> | null | undefined): WelcomeMenu | null {
  const m = settings?.welcome_menu as WelcomeMenu | undefined;
  return m && typeof m === 'object' && Array.isArray(m.options) ? m : null;
}

function slug(label: string) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'opcion'
  );
}

function toForm(o: WelcomeMenuOption): OptionForm {
  return {
    id: o.id,
    label: o.label,
    description: o.description ?? '',
    target: o.target.type === 'agent' ? o.target.agent_id : HUMAN,
    assignee: o.target.type === 'human' ? (o.target.assignee_user_id ?? '') : '',
  };
}

interface Props {
  channel: ChannelDTO;
  agents: AgentOption[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (channel: ChannelDTO) => void;
}

export function WelcomeMenuDialog({ channel, agents, readOnly, onClose, onSaved }: Props) {
  const t = useT();
  const { workspace } = useWorkspace();
  const initial = readWelcomeMenu(channel.settings);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [question, setQuestion] = useState(initial?.question ?? t('routing.menu.questionPlaceholder'));
  const [buttonLabel, setButtonLabel] = useState(initial?.button_label ?? '');
  const [options, setOptions] = useState<OptionForm[]>(() => (initial?.options ?? []).map(toForm));
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

  const isList = options.length > MAX_BUTTONS;
  const titleMax = isList ? LIST_TITLE : BUTTON_TITLE;

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    (async () => {
      let profiles: { user_id: string; full_name: string | null; email: string | null }[] = [];
      try {
        const res = await fetch('/api/inbox/members', { cache: 'no-store' });
        if (res.ok) profiles = ((await res.json()).members ?? []) as typeof profiles;
      } catch {
        // offline — the picker stays empty
      }
      if (!profiles.length) return;
      if (cancelled) return;
      setMembers(
        (profiles ?? []).map((p) => ({ user_id: p.user_id as string, name: (p.full_name as string) || (p.email as string) || '—' })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const update = (i: number, patch: Partial<OptionForm>) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, dir: -1 | 1) =>
    setOptions((list) => {
      const next = [...list];
      const [o] = next.splice(i, 1);
      next.splice(i + dir, 0, o);
      return next;
    });
  const add = () =>
    setOptions((list) =>
      list.length >= MAX_OPTIONS ? list : [...list, { id: '', label: '', description: '', target: agents.find((a) => a.enabled)?.id ?? HUMAN, assignee: '' }],
    );

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!enabled) return out;
    if (!question.trim()) out.push(t('routing.menu.errors.question'));
    if (options.length === 0) out.push(t('routing.menu.errors.noOptions'));
    options.forEach((o, i) => {
      if (!o.label.trim()) out.push(t('routing.menu.errors.label', { n: i + 1 }));
      else if (o.label.trim().length > titleMax) out.push(t('routing.menu.errors.labelTooLong', { n: i + 1, max: titleMax }));
      if (!o.target) out.push(t('routing.menu.errors.agent', { n: i + 1 }));
    });
    return out;
  }, [enabled, question, options, titleMax, t]);

  const payload = (): WelcomeMenu => {
    const used = new Set(options.map((o) => o.id).filter(Boolean));
    return {
      enabled,
      question: question.trim(),
      ...(buttonLabel.trim() ? { button_label: buttonLabel.trim() } : {}),
      options: options.map((o) => {
        let id = o.id;
        if (!id) {
          const base = slug(o.label);
          id = base;
          for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
          used.add(id);
        }
        return {
          id,
          label: o.label.trim(),
          ...(o.description.trim() ? { description: o.description.trim() } : {}),
          target: o.target === HUMAN ? { type: 'human' as const, assignee_user_id: o.assignee || null } : { type: 'agent' as const, agent_id: o.target },
        };
      }),
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || errors.length) return;
    setSaving(true);
    try {
      const { channel: saved } = await apiJson<{ channel: ChannelDTO }>(`/api/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ settings: { welcome_menu: payload() } }),
      });
      toast.success(t('routing.menu.saved'));
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const previewOptions = options.filter((o) => o.label.trim());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {t('routing.menu.title')} · {channel.name}
            </DialogTitle>
            <DialogDescription>{t('routing.menu.dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
            <fieldset disabled={readOnly} className="grid min-w-0 content-start gap-4">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="wm-enabled">{t('routing.menu.enabled')}</Label>
                  <p className="text-xs text-muted-foreground">{t('routing.menu.enabledHelp')}</p>
                </div>
                <Switch id="wm-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="wm-question">{t('routing.menu.question')}</Label>
                <Textarea id="wm-question" rows={2} maxLength={1024} value={question} placeholder={t('routing.menu.questionPlaceholder')} onChange={(e) => setQuestion(e.target.value)} />
              </div>

              {isList && (
                <div className="grid gap-1.5">
                  <Label htmlFor="wm-button">{t('routing.menu.buttonLabel')}</Label>
                  <Input id="wm-button" maxLength={20} value={buttonLabel} placeholder={t('routing.menu.buttonLabelPlaceholder')} onChange={(e) => setButtonLabel(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('routing.menu.buttonLabelHelp')}</p>
                </div>
              )}

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t('routing.menu.options', { count: options.length, max: MAX_OPTIONS })}</span>
                  <Button type="button" size="sm" variant="outline" onClick={add} disabled={options.length >= MAX_OPTIONS}>
                    <Plus className="size-3.5" />
                    {t('routing.menu.addOption')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('routing.menu.limitHint')}</p>
                {agents.length === 0 && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{t('routing.menu.noAgents')}</p>}

                <ol className="grid gap-2">
                  {options.map((o, i) => {
                    const over = o.label.trim().length > titleMax;
                    return (
                      <li key={i} className="grid gap-2 rounded-md border border-border p-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{i + 1}</span>
                          <div className="grid min-w-0 flex-1 gap-1">
                            <Label htmlFor={`wm-label-${i}`} className="sr-only">
                              {t('routing.menu.label')}
                            </Label>
                            <Input
                              id={`wm-label-${i}`}
                              value={o.label}
                              maxLength={LIST_TITLE}
                              aria-invalid={over || undefined}
                              placeholder={t('routing.menu.labelPlaceholder')}
                              onChange={(e) => update(i, { label: e.target.value })}
                            />
                            <span className={cn('text-right text-[11px]', over ? 'text-destructive' : 'text-muted-foreground')}>
                              {t('routing.menu.chars', { n: o.label.trim().length, max: titleMax })}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('routing.menu.moveUp')}>
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" disabled={i === options.length - 1} onClick={() => move(i, 1)} aria-label={t('routing.menu.moveDown')}>
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
                              aria-label={t('routing.menu.remove')}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-2 pl-7 sm:grid-cols-2">
                          <div className="grid gap-1">
                            <Label htmlFor={`wm-target-${i}`} className="text-xs text-muted-foreground">
                              {t('routing.menu.target')}
                            </Label>
                            <select id={`wm-target-${i}`} className={cn(selectClass, 'w-full')} value={o.target} onChange={(e) => update(i, { target: e.target.value })}>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  🤖 {a.name}
                                  {a.enabled ? '' : ` (${t('channels.agentDisabled')})`}
                                </option>
                              ))}
                              {o.target !== HUMAN && !agents.some((a) => a.id === o.target) && <option value={o.target}>{t('routing.flowNode.missingAgent')}</option>}
                              <option value={HUMAN}>👥 {t('routing.menu.targetHuman')}</option>
                            </select>
                          </div>
                          {o.target === HUMAN && (
                            <div className="grid gap-1">
                              <Label htmlFor={`wm-assignee-${i}`} className="text-xs text-muted-foreground">
                                {t('routing.menu.assignee')}
                              </Label>
                              <select id={`wm-assignee-${i}`} className={cn(selectClass, 'w-full')} value={o.assignee} onChange={(e) => update(i, { assignee: e.target.value })}>
                                <option value="">{t('routing.menu.assigneeAnyone')}</option>
                                {members.map((m) => (
                                  <option key={m.user_id} value={m.user_id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="grid gap-1 sm:col-span-2">
                            <Label htmlFor={`wm-desc-${i}`} className="text-xs text-muted-foreground">
                              {t('routing.menu.descriptionField')}
                            </Label>
                            <Input
                              id={`wm-desc-${i}`}
                              value={o.description}
                              maxLength={DESCRIPTION}
                              placeholder={t('routing.menu.descriptionPlaceholder')}
                              onChange={(e) => update(i, { description: e.target.value })}
                            />
                            {!isList && o.description && <p className="text-[11px] text-muted-foreground">{t('routing.menu.descriptionHint')}</p>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {errors.length > 0 && (
                <ul role="alert" className="grid gap-0.5 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </fieldset>

            <MenuPreview
              question={question}
              options={previewOptions}
              isList={isList}
              buttonLabel={buttonLabel || t('routing.menu.buttonLabelPlaceholder')}
              agents={agents}
              enabled={enabled}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('agents.close') : t('common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving || errors.length > 0}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('common.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MenuPreview({
  question,
  options,
  isList,
  buttonLabel,
  agents,
  enabled,
}: {
  question: string;
  options: OptionForm[];
  isList: boolean;
  buttonLabel: string;
  agents: AgentOption[];
  enabled: boolean;
}) {
  const t = useT();
  const targetName = (o: OptionForm) => (o.target === HUMAN ? t('routing.menu.targetHuman') : (agents.find((a) => a.id === o.target)?.name ?? '—'));
  const title = (o: OptionForm) => o.label.trim().slice(0, isList ? LIST_TITLE : BUTTON_TITLE);

  return (
    <div className={cn('grid content-start gap-2', !enabled && 'opacity-50')} aria-label={t('routing.menu.preview')}>
      <span className="text-sm font-medium">{t('routing.menu.preview')}</span>
      <div className="rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
        {!question.trim() || options.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-600 dark:text-slate-400">{t('routing.menu.previewEmpty')}</p>
        ) : (
          <div className="grid max-w-[230px] gap-1">
            <div className="rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[13px] whitespace-pre-wrap text-slate-900 shadow-sm dark:bg-[#202c33] dark:text-slate-100">
              {question.trim()}
              <span className="mt-0.5 block text-right text-[10px] text-slate-400">9:41</span>
            </div>
            {isList ? (
              <>
                <div className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-1.5 text-[13px] font-medium text-sky-600 shadow-sm dark:bg-[#202c33] dark:text-sky-400">
                  <List className="size-3.5" />
                  {buttonLabel.slice(0, 20)}
                </div>
                <div className="mt-1 grid divide-y divide-slate-200 rounded-lg bg-white shadow-sm dark:divide-slate-700 dark:bg-[#202c33]">
                  {options.map((o, i) => (
                    <div key={i} className="px-2.5 py-1.5">
                      <p className="text-[13px] text-slate-900 dark:text-slate-100">{title(o)}</p>
                      {o.description.trim() && <p className="text-[11px] text-slate-500">{o.description.trim()}</p>}
                      <PreviewTarget name={targetName(o)} human={o.target === HUMAN} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              options.map((o, i) => (
                <div key={i} className="rounded-lg bg-white py-1.5 text-center shadow-sm dark:bg-[#202c33]">
                  <p className="text-[13px] font-medium text-sky-600 dark:text-sky-400">{title(o)}</p>
                  <PreviewTarget name={targetName(o)} human={o.target === HUMAN} center />
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('routing.menu.previewOther')}</p>
    </div>
  );
}

function PreviewTarget({ name, human, center }: { name: string; human: boolean; center?: boolean }) {
  return (
    <p className={cn('mt-0.5 flex items-center gap-1 text-[10px] text-slate-500', center && 'justify-center')}>
      {human ? <Users className="size-2.5" /> : <Bot className="size-2.5" />}
      {name}
    </p>
  );
}
