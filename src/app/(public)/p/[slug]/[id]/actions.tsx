'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, Printer } from 'lucide-react';

declare global {
  interface Window {
    ChatNexGenChat?: { open: () => void; close: () => void; toggle: () => void };
  }
}

export function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/** Writes `text` in the widget composer once it exists (after a pre-chat form, too). */
function prefillWidget(text: string) {
  const started = Date.now();
  const tick = () => {
    const host = document.querySelector('[data-chatnexgen-webchat]');
    const input = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('#cnx-input');
    if (input && input.isConnected) {
      if (!input.value.trim()) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.focus();
      return;
    }
    if (Date.now() - started < 120_000) window.setTimeout(tick, 400);
  };
  tick();
}

/**
 * "Agendar visita": opens the workspace's web chat widget with a prefilled
 * message. Falls back to WhatsApp when there is no web chat channel.
 */
export function VisitButton({
  label,
  message,
  webchatKey,
  lang,
  whatsappHref,
  className,
}: {
  label: string;
  message: string;
  webchatKey: string | null;
  lang: string;
  whatsappHref: string | null;
  className?: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!webchatKey) return;
    if (!window.ChatNexGenChat && !document.querySelector('script[data-cnx-listing]')) {
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.async = true;
      s.setAttribute('data-key', webchatKey);
      s.setAttribute('data-lang', lang);
      s.setAttribute('data-cnx-listing', '');
      document.body.appendChild(s);
    }
    const id = window.setInterval(() => {
      if (window.ChatNexGenChat) {
        setReady(true);
        window.clearInterval(id);
      }
    }, 300);
    return () => window.clearInterval(id);
  }, [webchatKey, lang]);

  if (webchatKey && (ready || !whatsappHref)) {
    return (
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          document.querySelector('[data-chatnexgen-webchat]')?.setAttribute('data-cnx-open', '');
          window.ChatNexGenChat?.open();
          prefillWidget(message);
        }}
        className={className}
      >
        <CalendarCheck className="size-5" aria-hidden />
        {label}
      </button>
    );
  }
  if (!whatsappHref) return null;
  return (
    <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={className}>
      <CalendarCheck className="size-5" aria-hidden />
      {label}
    </a>
  );
}
