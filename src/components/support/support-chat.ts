'use client';

// "Chat online": the platform team's own web chat widget, loaded on demand
// (no floating button) with the user's name and email already filled in.

declare global {
  interface Window {
    ChatNexGenChat?: { open: () => void; close: () => void; toggle: () => void };
  }
}

let loading: Promise<void> | null = null;

export function openSupportChat(key: string, who: { name?: string | null; email?: string | null }): Promise<void> {
  if (window.ChatNexGenChat) {
    window.ChatNexGenChat.open();
    return Promise.resolve();
  }
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/widget.js';
      s.async = true;
      s.dataset.key = key;
      s.dataset.launcher = 'false';
      if (who.name) s.dataset.name = who.name;
      if (who.email) s.dataset.email = who.email;
      s.onerror = () => {
        loading = null;
        reject(new Error('widget failed to load'));
      };
      document.body.appendChild(s);
      // The widget defines window.ChatNexGenChat after fetching its config.
      const started = Date.now();
      const wait = () => {
        if (window.ChatNexGenChat) return resolve();
        if (Date.now() - started > 15_000) {
          loading = null;
          return reject(new Error('widget did not start'));
        }
        setTimeout(wait, 100);
      };
      wait();
    });
  }
  return loading.then(() => window.ChatNexGenChat?.open());
}
