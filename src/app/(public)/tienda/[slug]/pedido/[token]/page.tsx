import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { followSlug } from '@/lib/store/follow-slug';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { loadPublicOrder, loadStore, storeMoney } from '@/lib/store/server';
import { storePath } from '@/lib/store/settings';
import { fill, storeTexts } from '@/lib/store/texts';

type Props = { params: Promise<{ slug: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The customer's order: what they bought, its status and how to pay. The link is the secret. */
export default async function StoreOrderPage({ params }: Props) {
  const { slug, token } = await params;
  const s = await loadStore(slug);
  if (!s) notFound();
  followSlug(slug, s.workspace.slug, `/pedido/${encodeURIComponent(token)}`);
  const order = await loadPublicOrder(s, token);
  if (!order) notFound();
  const t = storeTexts(s.workspace.locale);
  const money = storeMoney(s.workspace);
  const accent = s.store.accent;
  const wa = (text: string) => (s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}` : null);
  const needsProof = order.payment && order.payment.requires_proof && (order.payment_status === 'awaiting_proof' || order.payment_status === 'unpaid');
  const proofLink = wa(fill(t.proofMessage, { number: order.number }));
  const askLink = wa(fill(t.askMessage, { number: order.number }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="rounded-3xl bg-white p-6 text-center ring-1 ring-slate-200">
        <CheckCircle2 className="mx-auto size-12" style={{ color: accent }} aria-hidden />
        <h1 className="mt-3 text-xl font-bold sm:text-2xl">{fill(t.orderTitle, { name: order.customer_name?.split(' ')[0] ?? '' })}</h1>
        <p className="mt-1 text-sm text-slate-600">{fill(t.orderNumber, { number: order.number })} · {t.orderNext}</p>
        <p className="mt-3 inline-flex flex-wrap justify-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{order.fulfillment === 'service' && order.status === 'delivered' ? t.serviceDone : (t.status[order.status] ?? order.status)}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{t.paymentStatus[order.payment_status] ?? order.payment_status}</span>
        </p>
      </section>

      {order.status !== 'cancelled' && order.payment_status === 'proof_received' && (
        <p role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm text-emerald-900 ring-1 ring-emerald-200">{t.proofReceivedNote}</p>
      )}
      {order.status !== 'cancelled' && order.pay_on_site && order.payment_status === 'unpaid' && (
        <p className="rounded-2xl bg-white px-5 py-4 text-sm text-slate-700 ring-1 ring-slate-200">{fill(t.payOnSiteNote, { amount: money(order.total) })}</p>
      )}

      {order.payment && (order.payment_status === 'unpaid' || order.payment_status === 'awaiting_proof') && order.status !== 'cancelled' && (
        <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-200" aria-labelledby="pay-title">
          <h2 id="pay-title" className="text-base font-semibold">{t.howToPay}</h2>
          <p className="text-lg font-bold">{fill(t.payTotal, { amount: money(order.total) })} · {order.payment.name}</p>
          {order.payment.instructions && <p className="whitespace-pre-line text-sm text-slate-700">{order.payment.instructions}</p>}
          {order.payment.qr_image_url && (
            // eslint-disable-next-line @next/next/no-img-element -- QR image from storage
            <img src={order.payment.qr_image_url} alt={order.payment.name} className="mx-auto w-full max-w-64 rounded-xl ring-1 ring-slate-200" />
          )}
          {needsProof && proofLink && (
            <a href={proofLink} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#25D366] text-sm font-semibold text-white hover:opacity-90">
              <MessageCircle className="size-5" aria-hidden /> {t.sendProof}
            </a>
          )}
        </section>
      )}

      <section className="space-y-3 rounded-3xl bg-white p-6 ring-1 ring-slate-200" aria-labelledby="sum-title">
        <h2 id="sum-title" className="text-base font-semibold">{t.summary}</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {order.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3 py-2">
              <span>{i.quantity} × {i.name}</span>
              <span className="tabular-nums">{money(i.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">{t.subtotal}</dt><dd className="tabular-nums">{money(order.subtotal)}</dd></div>
          {order.fulfillment !== 'service' && <div className="flex justify-between"><dt className="text-slate-600">{t.shipping}{order.shipping_name ? ` · ${order.shipping_name}` : ''}</dt><dd className="tabular-nums">{order.shipping_on_delivery ? t.onDelivery : order.delivery_fee === 0 ? t.free : money(order.delivery_fee)}</dd></div>}
          {order.fees.map((f, k) => (
            <div key={k} className="flex justify-between"><dt className="text-slate-600">{f.name}</dt><dd className="tabular-nums">{money(f.amount)}</dd></div>
          ))}
          <div className="flex justify-between text-base font-bold"><dt>{t.total}</dt><dd className="tabular-nums">{money(order.total)}</dd></div>
        </dl>
        {order.shipping_on_delivery && <p className="text-xs text-slate-500">{t.onDeliveryHint}</p>}
        {order.fulfillment === 'service' ? (
          order.booking ? (
            <p className="border-t border-slate-100 pt-3 text-sm text-slate-700">
              <span className="font-medium">{t.yourBooking}:</span>{' '}
              <span>
                {fill(t.bookingAt, {
                  date: new Intl.DateTimeFormat(s.workspace.locale === 'en' ? 'en-US' : 'es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${order.booking.date}T12:00:00Z`)),
                  time: order.booking.time,
                })}
              </span>
              {order.booking.staff ? ` ${fill(t.withStaff, { name: order.booking.staff })}` : ''}
            </p>
          ) : (
            <p className="border-t border-slate-100 pt-3 text-sm text-slate-700">{t.laterNote}</p>
          )
        ) : (
        <p className="border-t border-slate-100 pt-3 text-sm text-slate-700">
          <span className="font-medium">{t.deliverTo}:</span> {order.fulfillment === 'pickup' ? fill(t.pickupAt, { address: s.store.pickup_address ?? s.workspace.name }) : order.address}
        </p>
        )}
      </section>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        {askLink && (
          <a href={askLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: accent }}>
            <MessageCircle className="size-4" aria-hidden /> {t.askAbout}
          </a>
        )}
        <Link href={storePath(s.workspace.slug)} className="text-sm text-slate-600 hover:text-slate-900">{t.keepShopping}</Link>
      </div>
    </div>
  );
}
