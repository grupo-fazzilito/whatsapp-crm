'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CalendarCheck, CircleHelp, Compass, LifeBuoy, MessageCircle, Ticket } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useAuth } from '@/hooks/use-auth';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTour } from '@/components/tour/guided-tour';
import { CreateTicketDialog } from './create-ticket-dialog';
import { openSupportChat } from './support-chat';
import { useSetupHelpUrl } from './setup-help-dialog';
import { SETUP_HELP_PRICE } from '@/lib/support/setup-offer';

const iconBtn =
  'flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Top bar: replay the guided tour. */
export function TourButton() {
  const { t } = useI18n();
  const { start } = useTour();
  return (
    <button type="button" data-tour="tour-button" onClick={start} aria-label={t('tour.button')} title={t('tour.button')} className={iconBtn}>
      <Compass className="h-4.5 w-4.5" aria-hidden />
    </button>
  );
}

/** Top bar "?": create a ticket, live chat with the platform team, my tickets. */
export function HelpMenu() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [ticketOpen, setTicketOpen] = useState(false);
  const setupUrl = useSetupHelpUrl();

  const chat = async () => {
    const res = await fetch('/api/support/config', { cache: 'no-store' }).catch(() => null);
    const cfg = (res?.ok ? await res.json() : null) as { chat: { key: string } | null; whatsapp: string | null } | null;
    if (cfg?.chat?.key) {
      try {
        await openSupportChat(cfg.chat.key, { name: profile?.full_name, email: profile?.email });
        return;
      } catch {
        // fall through to the alternatives
      }
    }
    if (cfg?.whatsapp) {
      window.open(`https://wa.me/${cfg.whatsapp}`, '_blank', 'noopener,noreferrer');
      return;
    }
    toast.info(t('support.chatUnavailable'));
    setTicketOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-tour="help-button" aria-label={t('support.help')} title={t('support.help')} className={iconBtn}>
          <CircleHelp className="h-4.5 w-4.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-56 border border-border bg-popover text-popover-foreground">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <LifeBuoy className="size-3.5" aria-hidden /> {t('support.help')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem onClick={() => setTicketOpen(true)}>
              <Ticket className="size-4" aria-hidden />
              {t('support.createTicket')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void chat()}>
              <MessageCircle className="size-4" aria-hidden />
              {t('support.chatOnline')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {setupUrl && (
            <DropdownMenuItem render={<a href={setupUrl} target="_blank" rel="noopener noreferrer" />}>
              <CalendarCheck className="size-4" aria-hidden />
              {t('setupHelp.menu', { price: SETUP_HELP_PRICE })}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem render={<Link href="/support" />}>
            <LifeBuoy className="size-4" aria-hidden />
            {t('support.myTickets')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTicketDialog open={ticketOpen} onOpenChange={setTicketOpen} />
    </>
  );
}
