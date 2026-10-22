"use client";

import { useState, useEffect, useCallback } from "react";
import { useRealtimeChanges } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";
import type { Contact, ContactNote, Conversation, CustomField, Profile, Tag, ContactIdentity } from "@/types";
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
  Building2,
  Pencil,
  Tag as TagIcon,
  StickyNote,
  Plus,
  Link2,
  ListPlus,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ConversationCrmPanel } from "@/components/crm";
import { LeadPanel } from "@/components/real-estate/lead-panel";
import { CustomFieldInput } from "@/components/crm/custom-field-input";
import type { Team } from "@/lib/inbox/types";
import { AttentionPanel } from "./attention-panel";
import { TagChip } from "./tag-chip";
import type { ConversationPatch } from "./message-thread";
import type { InboxChannel } from "./channel-badge";
import type { InboxAgent } from "./use-inbox-directory";
import type { TeamMemberInfo } from "./use-inbox-extras";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Open conversation, so CRM deals/tasks created here link back to it. */
  conversationId?: string | null;
  /** The open conversation itself (attention block: assignee, team, AI). */
  conversation?: Conversation | null;
  channel?: InboxChannel | null;
  agentsById?: Map<string, InboxAgent>;
  members?: Profile[];
  teams?: Team[];
  teamMembers?: TeamMemberInfo[];
  /** Workspace tags (to add to the contact). */
  tags?: Tag[];
  onConversationPatch?: (conversationId: string, patch: ConversationPatch) => void;
  /** The contact was edited here. */
  onContactUpdated?: (contact: Contact) => void;
  className?: string;
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
    let res: { orders?: SidebarOrder[]; cart?: unknown } = {};
    try {
      const r = await fetch(`/api/inbox/contacts/${contactId}/orders`, { cache: "no-store" });
      if (r.ok) res = await r.json();
    } catch {
      // offline — keep the empty card; the next change reloads it
    }
    const ordersRes = { data: res.orders ?? null };
    const cartRes = { data: res.cart ?? null };
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
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Live: any change to this contact's orders reloads the card.
  useRealtimeChanges<{ contact_id?: string | null }>({
    workspaceId: workspace.id,
    tables: ["orders"],
    onChange: (change) => {
      const row = change.eventType === "DELETE" ? change.old : change.new;
      if (row.contact_id === contactId) void load();
    },
  });

  if (!ordersOn && orders.length === 0 && !cart) return null;

  const subtotal = cart?.reduce((a, l) => a + (l.unitPrice ?? 0) * l.quantity, 0) ?? 0;
  const dateLocale = locale === "es" ? esLocale : enUS;

  return (
    <>
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


const sectionTitle = "flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500";
const fieldClass =
  "h-8 w-full rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-white placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Name, phone, email and company — read, or edited in place. */
function ContactDetails({ contact, onUpdated }: { contact: Contact; onUpdated: (c: Contact) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "" });

  const startEdit = () => {
    setForm({ name: contact.name ?? "", phone: contact.phone ?? "", email: contact.email ?? "", company: contact.company ?? "" });
    setEditing(true);
  };

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error || t("common.error"));
        return;
      }
      const trim = (v: string) => v.trim() || undefined;
      onUpdated({ ...contact, name: trim(form.name) ?? "", phone: trim(form.phone) ?? "", email: trim(form.email), company: trim(form.company) });
      setEditing(false);
      toast.success(t("inbox.sidebar.saved"));
    } finally {
      setBusy(false);
    }
  }

  const copyPhone = async () => {
    if (!contact.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (editing) {
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {(["name", "phone", "email", "company"] as const).map((k) => (
          <label key={k} className="grid gap-1 text-[11px] text-slate-400">
            {t(`inbox.sidebar.${k}`)}
            <input
              className={fieldClass}
              type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {t("inbox.sidebar.save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            {t("inbox.sidebar.cancel")}
          </Button>
        </div>
      </form>
    );
  }

  const rows = [
    contact.phone ? { icon: Phone, value: contact.phone, copy: true } : null,
    contact.email ? { icon: Mail, value: contact.email } : null,
    contact.company ? { icon: Building2, value: contact.company } : null,
  ].filter(Boolean) as { icon: typeof Phone; value: string; copy?: boolean }[];

  return (
    <div className="grid gap-1">
      {rows.length === 0 && <p className="px-1 text-xs text-slate-500">{t("inbox.sidebar.noData")}</p>}
      {rows.map((r) =>
        r.copy ? (
          <button
            key={r.value}
            type="button"
            onClick={() => void copyPhone()}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            <r.icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="flex-1 truncate text-left">{r.value}</span>
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3 text-slate-600" />}
          </button>
        ) : (
          <div key={r.value} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300">
            <r.icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="truncate">{r.value}</span>
          </div>
        ),
      )}
      <button
        type="button"
        onClick={startEdit}
        className="inline-flex items-center gap-1 justify-self-start rounded px-2 py-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        {t("inbox.sidebar.edit")}
      </button>
    </div>
  );
}

/** Contact tags: remove with ×, add from the workspace's tags. */
function ContactTags({
  contactId,
  tags,
  allTags,
  onChange,
}: {
  contactId: string;
  tags: Tag[];
  allTags: Tag[];
  onChange: (tags: Tag[]) => void;
}) {
  const { t } = useI18n();
  const available = allTags.filter((x) => !tags.some((y) => y.id === x.id));

  async function call(method: "POST" | "DELETE", tag: Tag) {
    const next = method === "POST" ? [...tags, tag] : tags.filter((x) => x.id !== tag.id);
    onChange(next);
    const res = await fetch(`/api/crm/contacts/${contactId}/tags`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tag.id }),
    }).catch(() => null);
    if (!res?.ok) {
      onChange(tags);
      toast.error(t("common.error"));
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {tags.length === 0 && <p className="px-1 text-xs text-slate-500">{t("inbox.sidebar.noTags")}</p>}
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          name={tag.name}
          color={tag.color}
          onRemove={() => void call("DELETE", tag)}
          removeLabel={t("inbox.sidebar.removeTag", { name: tag.name })}
        />
      ))}
      <select
        aria-label={t("inbox.sidebar.addTag")}
        className="h-6 max-w-32 rounded-full border border-dashed border-slate-600 bg-transparent px-2 text-[11px] text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        value=""
        onChange={(e) => {
          const tag = available.find((x) => x.id === e.target.value);
          if (tag) void call("POST", tag);
        }}
      >
        <option value="">+ {t("inbox.sidebar.addTag")}</option>
        {available.length === 0 && <option disabled>{t("inbox.sidebar.noMoreTags")}</option>}
        {available.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The workspace's custom fields for this contact, edited by type. */
function CustomFieldsCard({ contactId }: { contactId: string }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<CustomField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/contacts/${contactId}/custom-values`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fields: [], values: [] }))
      .catch(() => ({ fields: [], values: [] }))
      .then((d: { fields: CustomField[]; values: { custom_field_id: string; value: string }[] }) => {
        if (cancelled) return;
        setFields(d.fields);
        setValues(Object.fromEntries(d.values.map((v) => [v.custom_field_id, v.value])));
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/custom-values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (res.ok) toast.success(t("inbox.sidebar.fieldsSaved"));
      else toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sidebar-cf-title" className="grid gap-2">
      <h4 id="sidebar-cf-title" className={sectionTitle}>
        <ListPlus className="h-3 w-3" aria-hidden="true" />
        {t("inbox.sidebar.customFields")}
      </h4>
      {fields === null ? null : fields.length === 0 ? (
        <p className="px-1 text-xs text-slate-500">
          {t("crm.customFields.none")}{" "}
          <Link href="/settings?tab=custom-fields" className="text-primary underline-offset-2 hover:underline">
            {t("crm.customFields.create")}
          </Link>
        </p>
      ) : (
        <>
          {fields.map((f) => (
            <div key={f.id} className="grid gap-1">
              <label htmlFor={`sb-cf-${f.id}`} className="px-1 text-[11px] text-slate-400">
                {f.field_name}
              </label>
              <CustomFieldInput
                id={`sb-cf-${f.id}`}
                field={f}
                value={values[f.id] ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
          ))}
          <Button size="sm" variant="outline" className="justify-self-start" disabled={busy} onClick={() => void save()}>
            {t("inbox.sidebar.saveFields")}
          </Button>
        </>
      )}
    </section>
  );
}

export function ContactSidebar({
  contact,
  conversationId = null,
  conversation = null,
  channel = null,
  agentsById,
  members,
  teams,
  teamMembers,
  tags: allTags = [],
  onConversationPatch,
  onContactUpdated,
  className,
}: ContactSidebarProps) {
  const { workspace } = useWorkspace();
  const isRealEstate = workspace?.industry === "real_estate";
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"contact" | "crm">("contact");
  const [identities, setIdentities] = useState<ContactIdentity[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Notes, tags and channel identities of the contact, in one request.
  const contactId = contact?.id;
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    fetch(`/api/inbox/contacts/${contactId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res: { notes?: ContactNote[]; tags?: Record<string, unknown>[]; identities?: ContactIdentity[] } | null) => {
        if (cancelled || !res) return;
        setIdentities(res.identities ?? []);
        setNotes(res.notes ?? []);
        setTags((res.tags ?? []).filter((ct) => ct.tags).map((ct) => ct.tags as Tag));
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const r = await fetch(`/api/inbox/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_text: newNote.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.note) {
        setNotes((prev) => [body.note as ContactNote, ...prev]);
        setNewNote("");
      }
    } catch {
      // keep the draft; the agent can retry
    }
    setAddingNote(false);
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className={cn("flex h-full w-80 items-center justify-center border-l border-slate-800 bg-slate-900", className)}>
        <p className="text-sm text-slate-500">{t("inbox.sidebar.selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || t("inbox.thread.customer");
  const initials = displayName.charAt(0).toUpperCase();
  const tabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      active ? "bg-slate-950 text-white shadow-sm" : "text-slate-400 hover:text-white",
    );

  return (
    <div className={cn("flex h-full w-80 flex-col border-l border-slate-800 bg-slate-900", className)}>
      <ScrollArea className="flex-1">
        <div className="grid gap-4 p-4">
          {/* Who */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-700 text-base font-semibold text-white">
              {contact.avatar_url ? <img src={contact.avatar_url} alt="" className="h-11 w-11 object-cover" /> : initials}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">{displayName}</h3>
              {contact.company && <p className="truncate text-xs text-slate-400">{contact.company}</p>}
            </div>
          </div>

          {/* Attention: assignee, transfer, team, AI */}
          {conversation && onConversationPatch && (
            <AttentionPanel
              conversation={conversation}
              channel={channel}
              agentsById={agentsById}
              members={members}
              teams={teams}
              teamMembers={teamMembers}
              onConversationPatch={onConversationPatch}
            />
          )}

          {/* Contacto | CRM */}
          <div role="tablist" aria-label={t("inbox.sidebar.tabs.label")} className="flex gap-0.5 rounded-lg bg-slate-800 p-0.5">
            {(["contact", "crm"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                id={`sidebar-tab-${v}`}
                aria-selected={tab === v}
                aria-controls={`sidebar-panel-${v}`}
                tabIndex={tab === v ? 0 : -1}
                onClick={() => setTab(v)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = v === "contact" ? "crm" : "contact";
                    setTab(next);
                    document.getElementById(`sidebar-tab-${next}`)?.focus();
                  }
                }}
                className={tabClass(tab === v)}
              >
                {t(`inbox.sidebar.tabs.${v}`)}
              </button>
            ))}
          </div>

          {tab === "contact" ? (
            <div role="tabpanel" id="sidebar-panel-contact" aria-labelledby="sidebar-tab-contact" className="grid gap-4">
              <ContactDetails key={contact.id} contact={contact} onUpdated={(c) => onContactUpdated?.(c)} />

              {identities.length > 0 && (
                <section aria-labelledby="sidebar-channels-title">
                  <h4 id="sidebar-channels-title" className={sectionTitle}>
                    <Link2 className="h-3 w-3" aria-hidden="true" />
                    {t("inbox.sidebar.channels")}
                  </h4>
                  <ul className="mt-2 space-y-1">
                    {identities.map((idn) => (
                      <li key={idn.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-300">
                        <ChannelIcon type={idn.channel_type} size={18} />
                        <span className="min-w-0 flex-1 truncate" title={idn.external_id}>
                          {idn.handle || idn.external_id}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-500">{CHANNEL_TYPE_LABELS[idn.channel_type]}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby="sidebar-tags-title">
                <h4 id="sidebar-tags-title" className={sectionTitle}>
                  <TagIcon className="h-3 w-3" aria-hidden="true" />
                  {t("inbox.sidebar.tags")}
                </h4>
                <ContactTags contactId={contact.id} tags={tags} allTags={allTags} onChange={setTags} />
              </section>

              <section aria-labelledby="sidebar-notes-title">
                <h4 id="sidebar-notes-title" className={sectionTitle}>
                  <StickyNote className="h-3 w-3" aria-hidden="true" />
                  {t("inbox.sidebar.notes")}
                </h4>
                <div className="mt-2 flex gap-2">
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
                    <div key={note.id} className="rounded-lg bg-slate-800 px-3 py-2">
                      <p className="whitespace-pre-wrap text-xs text-slate-300">{note.note_text}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {format(new Date(note.created_at), "d MMM yyyy HH:mm", { locale: locale === "es" ? esLocale : enUS })}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div role="tabpanel" id="sidebar-panel-crm" aria-labelledby="sidebar-tab-crm" className="grid gap-4">
              {conversationId && (
                <ConversationCrmPanel
                  key={`${contact.id}-${conversationId}`}
                  conversationId={conversationId}
                  contactId={contact.id}
                  contactName={contact.name}
                />
              )}
              <CustomFieldsCard key={`cf-${contact.id}`} contactId={contact.id} />
              <OrdersCard key={contact.id} contactId={contact.id} />
              {isRealEstate && <LeadPanel key={`lead-${contact.id}`} contactId={contact.id} conversationId={conversationId} />}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
