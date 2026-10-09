'use client';

import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ThreadMessage {
  id: string;
  author_role: 'customer' | 'support';
  author_name: string | null;
  body: string;
  attachments: { name: string; url: string }[];
  created_at: string;
}

/** Conversation of a ticket. `side` = whose messages go on the right. */
export function TicketThread({ messages, side, labels, locale }: { messages: ThreadMessage[]; side: 'customer' | 'support'; labels: { customer: string; support: string }; locale: string }) {
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => {
        const mine = m.author_role === side;
        return (
          <li key={m.id} className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
            <span className="text-xs text-muted-foreground">
              {m.author_role === 'support' ? labels.support : m.author_name || labels.customer} · {fmt.format(new Date(m.created_at))}
            </span>
            <div className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
              {m.body}
              {m.attachments.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {m.attachments.map((a) => (
                    <li key={a.url}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
                        <Paperclip className="size-3" aria-hidden /> {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const STATUS_CLS: Record<string, string> = {
  open: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  in_progress: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  waiting_customer: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  closed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};
