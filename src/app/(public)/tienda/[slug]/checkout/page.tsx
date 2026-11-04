import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadCheckoutOptions, loadStore } from '@/lib/store/server';
import { storeTexts } from '@/lib/store/texts';
import { CheckoutForm } from './checkout-form';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadStore(slug);
  return { title: s ? `${storeTexts(s.workspace.locale).checkout} · ${s.workspace.name}` : 'Not found', robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: Props) {
  const { slug } = await params;
  const s = await loadStore(slug);
  if (!s) notFound();
  const { shipping, payments } = await loadCheckoutOptions(s.workspace.id);
  return (
    <CheckoutForm
      preview={s.preview}
      dialCode={s.dialCode}
      pickup={s.store.pickup_enabled ? { address: s.store.pickup_address ?? s.workspace.name } : null}
      note={s.store.checkout_note}
      shipping={shipping.map((p) => ({ id: p.id, name: p.name, type: p.type, eta: p.eta, free_over: p.free_over }))}
      payments={payments}
    />
  );
}
