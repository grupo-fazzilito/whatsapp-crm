// Row → public API resource. Field names match the webhook payload
// builders in migration 041 (public.webhook_*_json) so a resource looks
// the same in GET responses and in webhook events.

type Row = Record<string, unknown>

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export const CONTACT_SELECT =
  'id, name, phone, email, company, avatar_url, created_at, updated_at, contact_tags(tag:tags(id, name, color))'

export function serializeTag(t: Row) {
  return { id: t.id as string, name: t.name as string, color: (t.color as string) ?? null }
}

export function serializeContact(r: Row) {
  const tags = ((r.contact_tags as { tag: Row | null }[] | undefined) ?? [])
    .map((ct) => ct.tag)
    .filter((t): t is Row => !!t)
    .map(serializeTag)
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: r.id as string,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    company: (r.company as string) ?? null,
    avatar_url: (r.avatar_url as string) ?? null,
    tags,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export const CONVERSATION_SELECT =
  'id, contact_id, status, priority, assigned_agent_id, team_id, ai_agent_id, unread_count, last_message_text, last_message_at, last_customer_message_at, resolved_at, created_at, updated_at, channel:channels(id, type, name), contact:contacts(id, name, phone, email)'

export function serializeConversation(r: Row) {
  const ch = r.channel as Row | null
  const contact = r.contact as Row | null
  return {
    id: r.id as string,
    contact_id: r.contact_id as string,
    channel: ch ? { id: ch.id as string, type: ch.type as string, name: ch.name as string } : null,
    status: r.status as string,
    priority: r.priority as string,
    assigned_user_id: (r.assigned_agent_id as string) ?? null,
    team_id: (r.team_id as string) ?? null,
    ai_agent_id: (r.ai_agent_id as string) ?? null,
    unread_count: Number(r.unread_count ?? 0),
    last_message_text: (r.last_message_text as string) ?? null,
    last_message_at: (r.last_message_at as string) ?? null,
    last_customer_message_at: (r.last_customer_message_at as string) ?? null,
    resolved_at: (r.resolved_at as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    ...(contact
      ? { contact: { id: contact.id as string, name: (contact.name as string) ?? null, phone: (contact.phone as string) ?? null, email: (contact.email as string) ?? null } }
      : {}),
  }
}

export const MESSAGE_SELECT =
  'id, conversation_id, sender_type, sender_id, ai_agent_id, content_type, content_text, media_url, template_name, message_id, status, reply_to_message_id, interactive_reply_id, created_at'

export function serializeMessage(r: Row, conv: { contact_id: string; channel_type: string | null }) {
  return {
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    contact_id: conv.contact_id,
    channel_type: conv.channel_type,
    direction: r.sender_type === 'customer' ? 'inbound' : 'outbound',
    sender_type: r.sender_type as string,
    sender_user_id: (r.sender_id as string) ?? null,
    ai_agent_id: (r.ai_agent_id as string) ?? null,
    type: r.content_type as string,
    text: (r.content_text as string) ?? null,
    media_url: (r.media_url as string) ?? null,
    template_name: (r.template_name as string) ?? null,
    status: r.status as string,
    external_id: (r.message_id as string) ?? null,
    reply_to_message_id: (r.reply_to_message_id as string) ?? null,
    interactive_reply_id: (r.interactive_reply_id as string) ?? null,
    created_at: r.created_at as string,
  }
}

export const PRODUCT_SELECT =
  'id, name, description, price, compare_at_price, currency, sku, stock, track_stock, images, tags, attributes, is_active, is_featured, category_id, sort_order, external_url, created_at, updated_at, product_variants(id, name, options, sku, price, stock, is_active, sort_order)'

export function serializeProduct(r: Row, workspaceCurrency: string) {
  const variants = ((r.product_variants as Row[] | undefined) ?? [])
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((v) => ({
      id: v.id as string,
      name: v.name as string,
      options: (v.options as Record<string, string>) ?? {},
      sku: (v.sku as string) ?? null,
      price: num(v.price),
      stock: num(v.stock),
      is_active: !!v.is_active,
    }))
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    price: num(r.price),
    compare_at_price: num(r.compare_at_price),
    currency: ((r.currency as string) || workspaceCurrency || 'USD').toUpperCase(),
    sku: (r.sku as string) ?? null,
    track_stock: !!r.track_stock,
    stock: num(r.stock),
    images: (r.images as string[]) ?? [],
    tags: (r.tags as string[]) ?? [],
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    category_id: (r.category_id as string) ?? null,
    is_active: !!r.is_active,
    is_featured: !!r.is_featured,
    external_url: (r.external_url as string) ?? null,
    variants,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export const ORDER_SELECT =
  'id, number, status, payment_status, fulfillment, contact_id, conversation_id, customer_name, customer_phone, address, address_reference, notes, currency, subtotal, delivery_fee, discount, total, payment_method_name, paid_at, source, created_at, updated_at, order_items(id, product_id, variant_id, name, sku, quantity, unit_price, total, sort_order)'

export function serializeOrder(r: Row) {
  const items = ((r.order_items as Row[] | undefined) ?? [])
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((i) => ({
      id: i.id as string,
      product_id: (i.product_id as string) ?? null,
      variant_id: (i.variant_id as string) ?? null,
      name: i.name as string,
      sku: (i.sku as string) ?? null,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
    }))
  return {
    id: r.id as string,
    number: Number(r.number),
    status: r.status as string,
    payment_status: r.payment_status as string,
    fulfillment: r.fulfillment as string,
    contact_id: (r.contact_id as string) ?? null,
    conversation_id: (r.conversation_id as string) ?? null,
    customer_name: (r.customer_name as string) ?? null,
    customer_phone: (r.customer_phone as string) ?? null,
    address: (r.address as string) ?? null,
    address_reference: (r.address_reference as string) ?? null,
    notes: (r.notes as string) ?? null,
    currency: r.currency as string,
    subtotal: Number(r.subtotal),
    delivery_fee: Number(r.delivery_fee),
    discount: Number(r.discount ?? 0),
    total: Number(r.total),
    payment_method_name: (r.payment_method_name as string) ?? null,
    paid_at: (r.paid_at as string) ?? null,
    source: r.source as string,
    items,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export const BOOKING_SELECT =
  'id, status, booking_date, booking_time, duration_minutes, contact_id, conversation_id, service_id, staff_id, product_id, customer_name, party_size, notes, custom_fields, source, created_at, updated_at'

export function serializeBooking(r: Row) {
  return {
    id: r.id as string,
    status: (r.status as string) ?? 'pending',
    date: r.booking_date as string,
    time: r.booking_time as string,
    duration_minutes: Number(r.duration_minutes ?? 30),
    contact_id: r.contact_id as string,
    conversation_id: (r.conversation_id as string) ?? null,
    service_id: (r.service_id as string) ?? null,
    staff_id: (r.staff_id as string) ?? null,
    product_id: (r.product_id as string) ?? null,
    customer_name: (r.customer_name as string) ?? null,
    party_size: num(r.party_size),
    notes: (r.notes as string) ?? null,
    custom_fields: (r.custom_fields as Record<string, unknown>) ?? {},
    source: r.source as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export const DEAL_SELECT =
  'id, title, value, currency, status, pipeline_id, stage_id, contact_id, conversation_id, assigned_to, notes, expected_close_date, won_at, lost_at, lost_reason, created_at, updated_at'

export function serializeDeal(r: Row) {
  return {
    id: r.id as string,
    title: r.title as string,
    value: Number(r.value ?? 0),
    currency: (r.currency as string) ?? null,
    status: r.status as string,
    pipeline_id: r.pipeline_id as string,
    stage_id: r.stage_id as string,
    contact_id: (r.contact_id as string) ?? null,
    conversation_id: (r.conversation_id as string) ?? null,
    assigned_to: (r.assigned_to as string) ?? null,
    notes: (r.notes as string) ?? null,
    expected_close_date: (r.expected_close_date as string) ?? null,
    won_at: (r.won_at as string) ?? null,
    lost_at: (r.lost_at as string) ?? null,
    lost_reason: (r.lost_reason as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export const TASK_SELECT_API =
  'id, title, description, due_at, priority, status, result, assignee_user_id, contact_id, conversation_id, deal_id, created_by, completed_at, created_at, updated_at'

export function serializeTask(r: Row) {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    due_at: (r.due_at as string) ?? null,
    priority: r.priority as string,
    status: r.status as string,
    result: (r.result as string) ?? null,
    assignee_user_id: (r.assignee_user_id as string) ?? null,
    contact_id: (r.contact_id as string) ?? null,
    conversation_id: (r.conversation_id as string) ?? null,
    deal_id: (r.deal_id as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    completed_at: (r.completed_at as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}
