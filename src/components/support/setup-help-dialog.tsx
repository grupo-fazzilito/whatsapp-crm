'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, Check, MessageCircle } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SETUP_HELP_PRICE, setupHelpWhatsAppUrl } from '@/lib/support/setup-offer';

/** Support WhatsApp number set in the admin panel (null when unset). */
async function supportWhatsApp(): Promise<string | null> {
  const res = await fetch('/api/support/config', { cache: 'no-store' }).catch(() => null);
  const cfg = (res?.ok ? await res.json() : null) as { whatsapp: string | null } | null;
  return cfg?.whatsapp || null;
}

function useSetupMessage() {
  const { t } = useI18n();
  const { workspace } = useWorkspace();
  return t('setupHelp.message', { business: workspace?.name ?? '', price: SETUP_HELP_PRICE });
}

/**
 * One-time offer of assisted setup (S/ 250 over Google Meet), shown to owners
 * and admins once the guided tour is done. The only action is opening a
 * WhatsApp chat with the platform team; nothing is filled in here.
 */
export function SetupHelpOffer() {
  const { t } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const { role } = useWorkspace();
  const message = useSetupMessage();
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const eligible = !!profile && !!profile.tour_completed_at && !profile.setup_offer_seen_at && (role === 'owner' || role === 'admin');

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const number = await supportWhatsApp();
      if (!alive || !number) return;
      setWhatsapp(number);
      setOpen(true);
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [eligible]);

  const answer = async () => {
    setOpen(false);
    await fetch('/api/me/setup-offer', { method: 'POST' }).catch(() => {});
    void refreshProfile();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) void answer(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5 text-primary" aria-hidden /> {t('setupHelp.title')}
          </DialogTitle>
          <DialogDescription>{t('setupHelp.body')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {(['i1', 'i2', 'i3'] as const).map((k) => (
            <li key={k} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {t(`setupHelp.${k}`)}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <span className="text-2xl font-bold">S/ {SETUP_HELP_PRICE}</span> <span className="text-muted-foreground">{t('setupHelp.once')}</span>
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => void answer()}>{t('setupHelp.dismiss')}</Button>
          <a
            href={whatsapp ? setupHelpWhatsAppUrl(whatsapp, message) : '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void answer()}
            className={buttonVariants()}
          >
            <MessageCircle className="size-4" aria-hidden /> {t('setupHelp.cta')}
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "?" menu entry: the WhatsApp link for assisted setup, or null while unset. */
export function useSetupHelpUrl(): string | null {
  const message = useSetupMessage();
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supportWhatsApp().then((n) => alive && setNumber(n));
    return () => {
      alive = false;
    };
  }, []);
  return number ? setupHelpWhatsAppUrl(number, message) : null;
}
