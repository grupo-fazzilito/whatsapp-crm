import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { followSlug } from '@/lib/store/follow-slug';
import { loadCheckoutOptions, loadStore } from '@/lib/store/server';
import { storeTexts } from '@/lib/store/texts';
import { loadPendingCheckout } from '@/lib/meta-catalog/orders';
import { CheckoutForm } from './checkout-form';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ pedido?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadStore(slug);
  return { title: s ? `${storeTexts(s.workspace.locale).checkout} · ${s.workspace.name}` : 'Not found', robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { pedido } = await searchParams;
  const s = await loadStore(slug);
  if (!s) notFound();
  followSlug(slug, s.workspace.slug, pedido ? `/checkout?pedido=${encodeURIComponent(pedido)}` : '/checkout');
  const [{ shipping, payments }, fromWhatsApp] = await Promise.all([
    loadCheckoutOptions(s.workspace.id),
    typeof pedido === 'string' ? loadPendingCheckout(s.workspace, pedido) : Promise.resolve(null),
  ]);
  return (
    <CheckoutForm
      preview={s.preview}
      dialCode={s.dialCode}
      pickup={s.store.pickup_enabled ? { address: s.store.pickup_address ?? s.workspace.name } : null}
      note={s.store.checkout_note}
      fees={s.store.fees}
      shipping={shipping.map((p) => ({ id: p.id, name: p.name, type: p.type, eta: p.eta, free_over: p.free_over }))}
      payments={payments}
      fromWhatsApp={fromWhatsApp}
      expired={typeof pedido === 'string' && !fromWhatsApp}
    />
  );
}
