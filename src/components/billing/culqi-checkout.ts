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

// Culqi3DS (3D Secure): when the bank wants the cardholder, its window asks
// for the bank's code and hands back `parameters3DS`, sent with the same
// charge again. Script: 3ds.culqi.com.

export interface Culqi3DSResult {
  eci: string;
  xid?: string;
  cavv: string;
  protocolVersion: string;
  directoryServerTransactionId?: string;
}

interface Culqi3DSLib {
  publicKey: string;
  settings: Record<string, unknown>;
  options: Record<string, unknown>;
  generateDevice(): Promise<string | null>;
  initAuthentication(tokenId: string): Promise<void>;
  reset(): void;
}

declare global {
  interface Window {
    Culqi3DS?: Culqi3DSLib;
  }
}

const SCRIPT_3DS = 'https://3ds.culqi.com';
let loading3ds: Promise<void> | null = null;

function load3DS(): Promise<void> {
  if (typeof window !== 'undefined' && window.Culqi3DS) return Promise.resolve();
  loading3ds ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_3DS;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading3ds = null;
      reject(new Error('culqi_script'));
    };
    document.body.appendChild(s);
  });
  return loading3ds;
}

/** Culqi3DS's device id, sent with every card charge (both tries); null if the script can't load. */
export async function culqiDeviceId(publicKey: string): Promise<string | null> {
  try {
    await load3DS();
    const lib = window.Culqi3DS;
    if (!lib) return null;
    lib.publicKey = publicKey;
    return (await lib.generateDevice()) ?? null;
  } catch {
    return null;
  }
}

/** Opens the bank's verification for this token and amount; resolves with its result or rejects with its error. */
export async function culqi3DS(input: { publicKey: string; tokenId: string; amountCents: number; email: string }): Promise<Culqi3DSResult> {
  await load3DS();
  const lib = window.Culqi3DS;
  if (!lib) throw new Error('culqi_script');
  lib.reset();
  lib.publicKey = input.publicKey;
  lib.settings = {
    charge: { totalAmount: input.amountCents, returnUrl: window.location.href, currency: 'PEN' },
    card: { email: input.email },
  };
  lib.options = { showModal: true, showLoading: true, showIcon: true, closeModalAction: () => window.postMessage({ error: 'culqi_3ds_closed' }, window.location.origin) };
  return new Promise<Culqi3DSResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { parameters3DS?: Culqi3DSResult; error?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.parameters3DS) {
        window.removeEventListener('message', onMessage);
        resolve(data.parameters3DS);
      } else if (data.error) {
        window.removeEventListener('message', onMessage);
        reject(new Error(data.error === 'culqi_3ds_closed' ? 'culqi_3ds_closed' : 'culqi_3ds_failed'));
      }
    };
    window.addEventListener('message', onMessage);
    lib.initAuthentication(input.tokenId).catch(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('culqi_3ds_failed'));
    });
  });
}
