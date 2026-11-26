'use client';

// Culqi Checkout in the browser: turns the card into a token (tkn_…) with the
// public key; the card never reaches our server. Script: js.culqi.com/checkout-js.

interface CulqiInstance {
  open(): void;
  close(): void;
  culqi: () => void;
  token?: { id: string } | null;
  error?: { user_message?: string; merchant_message?: string } | null;
}

declare global {
  interface Window {
    CulqiCheckout?: new (publicKey: string, config: Record<string, unknown>) => CulqiInstance;
  }
}

const SCRIPT = 'https://js.culqi.com/checkout-js';
let loading: Promise<void> | null = null;

function loadCulqi(): Promise<void> {
  if (typeof window !== 'undefined' && window.CulqiCheckout) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('culqi_script'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Culqi Checkout (cards only) and resolves with the card token. Shows
 * `amountCents` as the price; nothing is charged here (our server charges).
 */
export async function culqiCardToken(input: { publicKey: string; amountCents: number; email?: string | null; title: string }): Promise<string> {
  await loadCulqi();
  const Checkout = window.CulqiCheckout;
  if (!Checkout) throw new Error('culqi_script');
  return new Promise<string>((resolve, reject) => {
    const paymentMethods = { tarjeta: true, yape: false, billetera: false, bancaMovil: false, agente: false, cuotealo: false };
    const culqi = new Checkout(input.publicKey, {
      settings: { title: input.title, currency: 'PEN', amount: input.amountCents },
      client: input.email ? { email: input.email } : {},
      options: { lang: 'auto', installments: false, modal: true, paymentMethods, paymentMethodsSort: Object.keys(paymentMethods) },
      appearance: {},
    });
    culqi.culqi = () => {
      if (culqi.token?.id) {
        const id = culqi.token.id;
        culqi.close();
        resolve(id);
      } else if (culqi.error) {
        culqi.close();
        reject(new Error(culqi.error.user_message || culqi.error.merchant_message || 'culqi_error'));
      }
    };
    culqi.open();
  });
}
