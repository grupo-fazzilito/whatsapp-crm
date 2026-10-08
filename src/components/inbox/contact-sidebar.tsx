"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, ContactIdentity } from "@/types";
import { useI18n } from "@/i18n/client";
import { es as esLocale, enUS } from "date-fns/locale";
import { CHANNEL_TYPE_LABELS } from "@/lib/channels/capabilities";
import { ChannelIcon } from "./channel-badge";
import Link from "next/link";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMoney, moneyLocale } from "@/lib/workspace/countries";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Link2,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

interface SidebarOrder {
  id: string;
  number: number;
  status: string;
  payment_status: string;
  total: number;
  currency: string;
  created_at: string;
}

interface SidebarCartLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
}

const PAYMENT_TONE: Record<string, string> = {
  unpaid: "text-slate-400",
  awaiting_proof: "text-amber-300",
  proof_received: "text-sky-300",
  paid: "text-emerald-300",
  refunded: "text-slate-400",
};

/** Recent orders of the contact + the open cart, for the agent. */
function OrdersCard({ contactId }: { contactId: string }) {
  const { workspace, modules } = useWorkspace();
  if (!workspace) return null;
  return <OrdersCardBody contactId={contactId} workspace={workspace} ordersOn={modules.orders} />;
}

function OrdersCardBody({
  contactId,
  workspace,
  ordersOn,
}: {
  contactId: string;
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  ordersOn: boolean;
}) {
  const { t, locale } = useI18n();
  const [orders, setOrders] = useState<SidebarOrder[]>([]);
  const [cart, setCart] = useState<SidebarCartLine[] | null>(null);
  const money = useCallback(
    (n: number, currency?: string) =>
      formatMoney(n, currency || workspace.currency, moneyLocale(workspace)),
    [workspace],
  );

  const load = useCallback(async () => {
    const supabase = createClient();
    const [ordersRes, cartRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, number, status, payment_status, total, currency, created_at")
        .eq("workspace_id", workspace.id)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("carts")
        .select(
          "id, cart_items(id, quantity, product:products(name, price), variant:product_variants(name, price))",
        )
        .eq("workspace_id", workspace.id)
        .eq("contact_id", contactId)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setOrders(
      ((ordersRes.data ?? []) as SidebarOrder[]).map((o) => ({ ...o, total: Number(o.total) })),
    );
    type Row = {
      id: string;
      quantity: number;
      product: { name: string; price: number | null } | null;
      variant: { name: string; price: number | null } | null;
    };
    const rows = ((cartRes.data as { cart_items?: Row[] } | null)?.cart_items ?? []).filter(
      (r) => r.product,
    );
    setCart(
      rows.length
        ? rows.map((r) => {
            const price = r.variant?.price ?? r.product!.price;
            return {
              id: r.id,
              name: r.variant ? `${r.product!.name} (${r.variant.name})` : r.product!.name,
              quantity: r.quantity,
              unitPrice: price === null || price === undefined ? null : Number(price),
            };
          })
        : null,
    );
  }, [contactId, workspace.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const supabase = createClient();
    const channel = supabase
      .channel(`sidebar-orders-${contactId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `contact_id=eq.${contactId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [contactId, load]);

  if (!ordersOn && orders.length === 0 && !cart) return null;

  const subtotal = cart?.reduce((a, l) => a + (l.unitPrice ?? 0) * l.quantity, 0) ?? 0;
  const dateLocale = locale === "es" ? esLocale : enUS;

  return (
    <>
      <div className="my-4 border-t border-slate-800" />
      <section aria-labelledby="sidebar-orders-title">
        <h4
          id="sidebar-orders-title"
          className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500"
        >
          <ShoppingBag className="h-3 w-3" aria-hidden="true" />
          {t("inbox.sidebar.orders.title")}
        </h4>

        {cart && (
          <div className="mt-2 rounded-lg border border-dashed border-slate-700 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <ShoppingCart className="h-3 w-3" aria-hidden="true" />
              {t("inbox.sidebar.orders.openCart")}
            </p>
            <ul className="mt-1 space-y-0.5">
              {cart.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 text-xs text-slate-400">
                  <span className="min-w-0 truncate">
                    {l.quantity}× {l.name}
                  </span>
                  {l.unitPrice !== null && (
                    <span className="shrink-0 tabular-nums">{money(l.unitPrice * l.quantity)}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1 flex justify-between border-t border-slate-800 pt-1 text-xs text-slate-300">
              <span>{t("inbox.sidebar.orders.subtotal")}</span>
              <span className="tabular-nums">{money(subtotal)}</span>
            </p>
          </div>
        )}

        <div className="mt-2 space-y-2">
          {orders.length === 0 ? (
            <p className="px-1 text-xs text-slate-600">{t("inbox.sidebar.orders.none")}</p>
          ) : (
            orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders?order=${o.id}`}
                className="block rounded-lg bg-slate-800 px-3 py-2 transition-colors hover:bg-slate-700"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">#{o.number}</span>
                  <span className="text-sm tabular-nums text-slate-200">
                    {money(o.total, o.currency)}
                  </span>
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-slate-200">
                    {t(`inbox.sidebar.orders.status.${o.status}`)}
                  </span>
                  <span className={PAYMENT_TONE[o.payment_status] ?? "text-slate-400"}>
                    {t(`inbox.sidebar.orders.payment.${o.payment_status}`)}
                  </span>
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {format(new Date(o.created_at), "d MMM HH:mm", { locale: dateLocale })}
                </span>
              </Link>
            ))
          )}
        </div>
      </section>
    </>
  );
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [identities, setIdentities] = useState<ContactIdentity[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags and channel identities in parallel
    const [dealsRes, notesRes, tagsRes, identitiesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("contact_identities")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: true }),
    ]);

    setIdentities((identitiesRes.data as ContactIdentity[]) ?? []);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-slate-800 bg-slate-900">
        <p className="text-sm text-slate-500">{t("inbox.sidebar.selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || t("inbox.thread.customer");
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-slate-800 bg-slate-900">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold text-white">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-slate-400">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.phone && (
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              <Phone className="h-4 w-4 text-slate-500" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-slate-600" />
              )}
            </button>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300">
                <Mail className="h-4 w-4 text-slate-500" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Channel identities — the same person across channels */}
          {identities.length > 0 && (
            <>
              <div className="my-4 border-t border-slate-800" />
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                  <Link2 className="h-3 w-3" />
                  {t("inbox.sidebar.channels")}
                </div>
                <ul className="mt-2 space-y-1">
                  {identities.map((idn) => (
                    <li
                      key={idn.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-300"
                    >
                      <ChannelIcon type={idn.channel_type} size={18} />
                      <span className="min-w-0 flex-1 truncate" title={idn.external_id}>
                        {idn.handle || idn.external_id}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {CHANNEL_TYPE_LABELS[idn.channel_type]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <OrdersCard key={contact.id} contactId={contact.id} />

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <TagIcon className="h-3 w-3" />
              {t("inbox.sidebar.tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-slate-600">{t("inbox.sidebar.noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <DollarSign className="h-3 w-3" />
              {t("inbox.sidebar.deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-slate-600">{t("inbox.sidebar.noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-white">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <StickyNote className="h-3 w-3" />
              {t("inbox.sidebar.notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={t("inbox.sidebar.addNote")}
                  aria-label={t("inbox.sidebar.addNote")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  aria-label={t("inbox.sidebar.saveNote")}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-slate-300">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      {format(new Date(note.created_at), "d MMM yyyy HH:mm", {
                        locale: locale === "es" ? esLocale : enUS,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
