'use client';

import { Fragment, type ReactNode } from 'react';
import { List } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Bubble, PreviewChannel } from '@/lib/agents/render';

// Visual skins of each channel for the agent test chat. Only presentation:
// what goes in each bubble comes from renderForChannel().

export interface ChannelSkin {
  label: string;
  /** Chat area background. */
  area: string;
  header: string;
  headerText: string;
  /** Customer (outgoing from the customer's phone) bubble. */
  mine: string;
  /** Business / agent bubble. */
  theirs: string;
  /** Reply buttons / quick replies. */
  action: string;
  font: string;
  rounded: string;
  /** Chat background pattern, if the channel has one. */
  wallpaper?: string;
}

export const SKINS: Record<PreviewChannel, ChannelSkin> = {
  whatsapp: {
    label: 'WhatsApp',
    area: 'bg-[#efeae2] dark:bg-[#0b141a]',
    header: 'bg-[#008069] dark:bg-[#202c33]',
    headerText: 'text-white',
    mine: 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]',
    theirs: 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]',
    action: 'bg-white text-[#027eb5] dark:bg-[#202c33] dark:text-[#53bdeb]',
    font: 'text-[14.2px] leading-[19px]',
    rounded: 'rounded-lg',
    wallpaper: '/inbox-doodle.svg',
  },
  instagram: {
    label: 'Instagram',
    area: 'bg-white dark:bg-black',
    header: 'bg-white border-b border-neutral-200 dark:bg-black dark:border-neutral-800',
    headerText: 'text-neutral-900 dark:text-white',
    mine: 'bg-gradient-to-br from-[#7b3fe4] to-[#c13584] text-white',
    theirs: 'bg-[#efefef] text-neutral-900 dark:bg-[#262626] dark:text-white',
    action: 'border border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-black dark:text-white',
    font: 'text-[15px] leading-5',
    rounded: 'rounded-[22px]',
  },
  messenger: {
    label: 'Messenger',
    area: 'bg-white dark:bg-[#18191a]',
    header: 'bg-white border-b border-neutral-200 dark:bg-[#242526] dark:border-neutral-700',
    headerText: 'text-neutral-900 dark:text-white',
    mine: 'bg-[#0084ff] text-white',
    theirs: 'bg-[#e4e6eb] text-neutral-900 dark:bg-[#3a3b3c] dark:text-white',
    action: 'border border-[#0084ff] bg-white text-[#0084ff] dark:bg-[#242526]',
    font: 'text-[15px] leading-5',
    rounded: 'rounded-[18px]',
  },
  webchat: {
    label: 'Web chat',
    area: 'bg-slate-50 dark:bg-slate-950',
    header: 'bg-primary',
    headerText: 'text-primary-foreground',
    mine: 'bg-primary text-primary-foreground',
    theirs: 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100',
    action: 'border border-primary/40 bg-white text-primary dark:bg-slate-900',
    font: 'text-sm leading-5',
    rounded: 'rounded-2xl',
  },
};

/** WhatsApp markup → React (bold, italic, strike, monospace). No HTML injection. */
export function Formatted({ text, markup }: { text: string; markup: boolean }) {
  if (!markup) return <>{text}</>;
  const nodes: ReactNode[] = [];
  const re = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<code key={i++} className="font-mono text-[0.92em]">{m[1]}</code>);
    else if (m[2] !== undefined) nodes.push(<strong key={i++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={i++}>{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<s key={i++}>{m[4]}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((n, k) => (typeof n === 'string' ? <Fragment key={`t${k}`}>{n}</Fragment> : n))}</>;
}

function Img({ src, className }: { src: string; className?: string }) {
  // Product photos may come from any host the business uses.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className={cn('block w-full object-cover', className)} />;
}

/** One agent message as the channel renders it. */
export function AgentBubble({ bubble, channel, viewOptions }: { bubble: Bubble; channel: PreviewChannel; viewOptions: string }) {
  const s = SKINS[channel];
  const base = cn('max-w-[85%] whitespace-pre-wrap break-words px-3 py-2', s.theirs, s.rounded, s.font);

  switch (bubble.kind) {
    case 'text':
      return (
        <div className="flex max-w-[85%] flex-col items-start gap-1.5">
          <div className={cn(base, 'max-w-full')}>
            <Formatted text={bubble.text} markup={bubble.markup} />
          </div>
          {bubble.quickReplies && (
            <div className="flex flex-wrap gap-1.5">
              {bubble.quickReplies.map((q) => (
                <span key={q} className={cn('rounded-full px-3 py-1 text-xs font-medium', s.action)}>
                  {q}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case 'image':
      return (
        <div className={cn('w-60 overflow-hidden', s.theirs, s.rounded, channel === 'whatsapp' && 'p-1')}>
          <Img src={bubble.url} className={cn('aspect-square', channel === 'whatsapp' && 'rounded-md')} />
          {bubble.caption && (
            <div className={cn('whitespace-pre-wrap break-words px-2 py-1.5', s.font)}>
              <Formatted text={bubble.caption} markup={bubble.markup} />
            </div>
          )}
        </div>
      );
    case 'buttons':
      return (
        <div className="flex w-64 max-w-[85%] flex-col gap-0.5">
          <div className={cn('overflow-hidden', s.theirs, s.rounded)}>
            {bubble.imageUrl && <Img src={bubble.imageUrl} className="aspect-[4/3]" />}
            <div className={cn('whitespace-pre-wrap break-words px-3 py-2', s.font)}>
              <Formatted text={bubble.text} markup={bubble.markup} />
            </div>
          </div>
          {bubble.buttons.map((b) => (
            <div key={b} className={cn('px-3 py-2 text-center text-sm font-medium', s.action, s.rounded)}>
              {b}
            </div>
          ))}
        </div>
      );
    case 'list':
      return (
        <div className="flex w-64 max-w-[85%] flex-col gap-0.5">
          <div className={cn('whitespace-pre-wrap break-words px-3 py-2', s.theirs, s.rounded, s.font)}>
            <Formatted text={bubble.text} markup={bubble.markup} />
          </div>
          <details className={cn('text-sm', s.action, s.rounded)}>
            <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-3 py-2 font-medium">
              <List className="size-4" aria-hidden />
              {bubble.buttonLabel || viewOptions}
            </summary>
            <ul className="border-t border-black/10 px-3 py-1 text-foreground dark:border-white/10">
              {bubble.rows.map((r) => (
                <li key={r.title} className="py-1.5">
                  <span className="block text-sm">{r.title}</span>
                  {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      );
    case 'carousel':
      return (
        <div className="flex w-full flex-col items-start gap-1.5">
          {bubble.text && (
            <div className={base}>
              <Formatted text={bubble.text} markup={bubble.markup} />
            </div>
          )}
          <div className="flex w-full snap-x gap-2 overflow-x-auto pb-1" role="list">
            {bubble.cards.map((c, i) => (
              <div key={`${c.title}-${i}`} role="listitem" className={cn('w-52 shrink-0 snap-start overflow-hidden', s.theirs, s.rounded)}>
                <Img src={c.imageUrl} className="aspect-[4/3]" />
                <div className={cn('px-3 py-2', s.font)}>
                  {channel === 'whatsapp' || channel === 'webchat' ? (
                    <div className="whitespace-pre-wrap break-words">
                      <Formatted text={[`*${c.title}*`, c.subtitle].filter(Boolean).join('\n')} markup />
                    </div>
                  ) : (
                    <>
                      <p className="line-clamp-2 font-semibold">{c.title}</p>
                      {c.subtitle && <p className="text-xs opacity-70">{c.subtitle}</p>}
                    </>
                  )}
                </div>
                {c.buttons.length > 0 && (
                  <div className="border-t border-black/10 dark:border-white/10">
                    {c.buttons.map((b) => (
                      <div key={b} className="border-b border-black/5 px-3 py-2 text-center text-sm font-medium text-[#027eb5] last:border-0 dark:border-white/5 dark:text-[#53bdeb]">
                        {b}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
  }
}

/** Customer message bubble. */
export function CustomerBubble({ text, channel }: { text: string; channel: PreviewChannel }) {
  const s = SKINS[channel];
  return <div className={cn('ml-auto max-w-[85%] whitespace-pre-wrap break-words px-3 py-2', s.mine, s.rounded, s.font)}>{text}</div>;
}
