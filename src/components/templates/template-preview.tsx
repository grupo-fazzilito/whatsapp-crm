'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, FileText, ImageIcon, List, Phone, Play, Reply, Store } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';
import { SKINS } from '@/components/agents/channel-preview';
import { authenticationText, splitVariables, type TemplateDraft, type TemplateVariable } from '@/lib/templates/model';

const skin = SKINS.whatsapp;
const OTP_EXAMPLE = '123456';
// Characters from the Unicode private-use area stand in for variables while
// the WhatsApp markup is parsed, so `_` inside {{nombre_cliente}} is not read
// as italics and *{{nombre}}* still renders bold.
const OPEN = '';
const CLOSE = '';

type Leaf = (text: string, key: string) => ReactNode;

/** WhatsApp markup (same rules as `Formatted` in channel-preview) with a custom leaf renderer. */
function markup(text: string, leaf: Leaf): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(leaf(text.slice(last, m.index), `t${i++}`));
    if (m[1] !== undefined) nodes.push(<code key={i++} className="font-mono text-[0.92em]">{leaf(m[1], `c${i}`)}</code>);
    else if (m[2] !== undefined) nodes.push(<strong key={i++}>{leaf(m[2], `b${i}`)}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={i++}>{leaf(m[3], `e${i}`)}</em>);
    else if (m[4] !== undefined) nodes.push(<s key={i++}>{leaf(m[4], `s${i}`)}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(leaf(text.slice(last), `t${i++}`));
  return nodes;
}

/** Text with {{variables}} rendered as example values (highlighted) or as label chips. */
function RichText({ text, variables, examples, withMarkup = true }: { text: string; variables: TemplateVariable[]; examples: boolean; withMarkup?: boolean }) {
  const keys: string[] = [];
  const encoded = splitVariables(text)
    .map((p) => {
      if (!p.variable) return p.text;
      keys.push(p.variable);
      return `${OPEN}${keys.length - 1}${CLOSE}`;
    })
    .join('');

  const leaf: Leaf = (chunk, key) => {
    const parts = chunk.split(new RegExp(`${OPEN}(\\d+)${CLOSE}`));
    return (
      <Fragment key={key}>
        {parts.map((part, idx) => {
          if (idx % 2 === 0) return part ? <Fragment key={idx}>{part}</Fragment> : null;
          const k = keys[Number(part)];
          const v = variables.find((x) => x.key === k);
          const example = v?.example.trim();
          if (examples && example) {
            return (
              <span key={idx} className="rounded-[3px] bg-[#25d366]/15 px-0.5 dark:bg-[#25d366]/20">
                {example}
              </span>
            );
          }
          return (
            <span key={idx} className="mx-px inline-block rounded bg-sky-500/15 px-1 font-mono text-[0.85em] text-sky-800 dark:text-sky-300">
              {`{{${v?.label || k}}}`}
            </span>
          );
        })}
      </Fragment>
    );
  };

  return <>{withMarkup ? markup(encoded, leaf) : leaf(encoded, 'all')}</>;
}

function fileName(url?: string): string | null {
  if (!url) return null;
  try {
    const last = decodeURIComponent(new URL(url, 'https://x').pathname.split('/').pop() ?? '');
    return last || null;
  } catch {
    return null;
  }
}

interface ButtonRow {
  icon: ReactNode;
  text: string;
}

export function TemplatePreview({ draft, className }: { draft: TemplateDraft; className?: string }) {
  const { t } = useI18n();
  const { workspace } = useWorkspace();
  const [examples, setExamples] = useState(true);
  const business = workspace?.name || t('templates.preview.business');
  const isAuth = draft.category === 'Authentication';
  const auth = isAuth ? authenticationText(draft.language, draft.codeExpiration) : null;

  const buttons: ButtonRow[] = isAuth
    ? [{ icon: <Copy className="size-4" aria-hidden />, text: auth!.button }]
    : draft.buttons.map((b) => ({
        icon:
          b.type === 'url' ? <ExternalLink className="size-4" aria-hidden /> : b.type === 'phone' ? <Phone className="size-4" aria-hidden /> : <Reply className="size-4" aria-hidden />,
        text: b.text || t('templates.preview.buttonPlaceholder'),
      }));
  const shown = buttons.length > 3 ? buttons.slice(0, 2) : buttons;

  const header = draft.header;
  const mediaName = fileName(header.mediaUrl);
  const hasVariables = !isAuth && /\{\{/.test(`${draft.body}${header.type === 'text' ? header.text ?? '' : ''}`);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {hasVariables && (
        <div role="group" aria-label={t('templates.preview.modeLabel')} className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {[true, false].map((on) => (
            <button
              key={String(on)}
              type="button"
              aria-pressed={examples === on}
              onClick={() => setExamples(on)}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                examples === on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {on ? t('templates.preview.withExamples') : t('templates.preview.withVariables')}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-[460px] flex-col overflow-hidden rounded-[28px] border-[6px] border-neutral-900 bg-neutral-900 shadow-xl dark:border-neutral-700" aria-label={t('templates.preview.label')} role="figure">
        <div className={cn('flex items-center gap-3 px-4 py-3', skin.header)}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#ffffff]/20" aria-hidden>
            <Store className="size-5 text-[#ffffff]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#ffffff]">{business}</p>
            <p className="text-xs text-[#ffffff]/80">{t('templates.preview.businessAccount')}</p>
          </div>
        </div>

        <div className={cn('flex flex-1 flex-col items-start gap-1 px-3 py-4 bg-repeat', skin.area)} style={{ backgroundImage: `url('${skin.wallpaper}')` }}>
          <span className="mx-auto mb-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">{t('templates.preview.today')}</span>

          <div className="flex w-[85%] max-w-[300px] flex-col gap-0.5">
            <div className={cn('relative overflow-hidden shadow-sm', skin.theirs, skin.rounded, skin.font)}>
              {!isAuth && header.type === 'image' && (
                <div className="p-1">
                  {header.mediaUrl ? (
                    // The sample lives in our storage or any host the business uses.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={header.mediaUrl} alt="" className="block aspect-[1.91/1] w-full rounded-md object-cover" />
                  ) : (
                    <div className="flex aspect-[1.91/1] w-full items-center justify-center rounded-md bg-black/10 dark:bg-white/10">
                      <ImageIcon className="size-8 opacity-50" aria-hidden />
                    </div>
                  )}
                </div>
              )}
              {!isAuth && header.type === 'video' && (
                <div className="p-1">
                  <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black/80">
                    {header.mediaUrl && <video src={`${header.mediaUrl}#t=0.1`} preload="metadata" muted playsInline className="absolute inset-0 size-full object-cover" aria-hidden />}
                    <span className="relative flex size-12 items-center justify-center rounded-full bg-black/50">
                      <Play className="size-6 fill-[#ffffff] text-[#ffffff]" aria-hidden />
                    </span>
                  </div>
                </div>
              )}
              {!isAuth && header.type === 'document' && (
                <div className="p-1">
                  <div className="flex items-center gap-2.5 rounded-md bg-black/5 px-3 py-2.5 dark:bg-white/5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded bg-[#e2574c] text-[10px] font-bold text-[#ffffff]">PDF</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{mediaName ?? t('templates.preview.documentName')}</p>
                      <p className="flex items-center gap-1 text-[11px] opacity-60">
                        <FileText className="size-3" aria-hidden /> PDF
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="whitespace-pre-wrap break-words px-2.5 pt-1.5 pb-1">
                {!isAuth && header.type === 'text' && header.text?.trim() && (
                  <p className="mb-1 font-bold">
                    <RichText text={header.text} variables={draft.variables} examples={examples} withMarkup={false} />
                  </p>
                )}
                {isAuth ? (
                  <RichText text={auth!.body.replace('{code}', OTP_EXAMPLE)} variables={[]} examples />
                ) : draft.body.trim() ? (
                  <RichText text={draft.body} variables={draft.variables} examples={examples} />
                ) : (
                  <span className="italic opacity-50">{t('templates.preview.emptyBody')}</span>
                )}
                {(isAuth ? auth!.footer : draft.footer?.trim()) && (
                  <p className="mt-1 text-[13px] leading-[17px] text-[#667781] dark:text-[#8696a0]">{isAuth ? auth!.footer : draft.footer}</p>
                )}
                <span className="float-right -mb-0.5 ml-2 mt-1 flex items-center gap-0.5 text-[11px] leading-none text-[#667781] dark:text-[#8696a0]">
                  10:30
                </span>
                <span className="clear-both block" />
              </div>
            </div>

            {shown.map((b, i) => (
              <div key={i} className={cn('flex items-center justify-center gap-1.5 px-3 py-2 text-center text-sm font-medium shadow-sm', skin.action, skin.rounded)}>
                {b.icon}
                <span className="truncate">{b.text}</span>
              </div>
            ))}
            {buttons.length > 3 && (
              <div className={cn('flex items-center justify-center gap-1.5 px-3 py-2 text-center text-sm font-medium shadow-sm', skin.action, skin.rounded)}>
                <List className="size-4" aria-hidden />
                {t('templates.preview.allOptions')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
