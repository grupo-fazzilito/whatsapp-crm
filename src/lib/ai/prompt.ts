import { getPreset, resolveIndustry, industryLabel } from '@/lib/industries'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import { formatProductPrice } from '@/lib/catalog/currency'
import { freeSlotsForBusiness, freeSlotsForStaff, upcomingDates } from './slots'
import { weekdayOf, zonedNow } from './time'
import { productAttributesFor } from '@/lib/catalog/attributes'
import type { BusinessContext } from './context'
import type { AiAgentRow, BookingDraft } from './types'
import { CAPTURE_SCHEMA, LEAD_PROFILE_SCHEMA, qualifiesLeads, realEstateLeadSections, type CaptureOutput } from '@/lib/real-estate/leads/prompt-section'
import type { LeadFields } from '@/lib/real-estate/leads/types'

export const AGENT_INTENTS = [
  'greeting',
  'faq',
  'business_info',
  'service_info',
  'pricing',
  'availability',
  'booking',
  'cancel_booking',
  'catalog',
  'order',
  'handover',
  'transfer',
  'emergency',
  'farewell',
  'other',
] as const

export type BookingAction = 'none' | 'collecting' | 'confirm' | 'cancel'

export interface AgentOutput {
  reply: string
  intent: (typeof AGENT_INTENTS)[number]
  language: string
  confidence: number
  handover: boolean
  transfer_to_agent_id: string
  booking_action: BookingAction
  booking: {
    service_id?: string
    staff_id?: string
    date?: string
    time?: string
    customer_name?: string
    party_size?: number
    product_id?: string
    fields?: { key: string; value: string }[]
  }
  /** Ask the system to search the catalog; results come in a second turn. */
  catalog_search?: {
    text?: string
    category_id?: string
    filters?: { key: string; value: string }[]
    min_price?: number
    max_price?: number
    /** ISO currency of min/max_price (e.g. USD for "300 mil dólares"). */
    currency?: string
  }
  /** Products whose photo + price should be sent after the reply (max 3). */
  show_product_ids?: string[]
  /** Cart changes requested in this turn (orders skill). */
  cart_ops?: { op: 'add' | 'set' | 'remove'; product_id: string; variant_name?: string; quantity?: number }[]
  /** What to show after the reply: the cart summary or the checkout. */
  order_action?: 'none' | 'show_cart' | 'checkout'
  /** Real estate: what the buyer/tenant is looking for (merged server-side). */
  lead_profile?: Record<string, unknown>
  /** Real estate: owner who wants to sell/rent their own property. */
  capture?: CaptureOutput
}

/** Gemini responseSchema for AgentOutput. */
export const AGENT_OUTPUT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: 'Message to send to the customer' },
    intent: { type: 'STRING', enum: [...AGENT_INTENTS] },
    language: { type: 'STRING', description: 'ISO 639-1 code of the language the customer writes in' },
    confidence: { type: 'NUMBER' },
    handover: { type: 'BOOLEAN', description: 'true to pass the conversation to a human' },
    transfer_to_agent_id: { type: 'STRING', description: 'Agent id to transfer to, or empty string' },
    booking_action: { type: 'STRING', enum: ['none', 'collecting', 'confirm', 'cancel'] },
    booking: {
      type: 'OBJECT',
      properties: {
        service_id: { type: 'STRING' },
        staff_id: { type: 'STRING' },
        date: { type: 'STRING', description: 'YYYY-MM-DD' },
        time: { type: 'STRING', description: 'HH:MM 24h' },
        customer_name: { type: 'STRING' },
        party_size: { type: 'NUMBER' },
        product_id: { type: 'STRING', description: 'Product id (e.g. property to visit)' },
        fields: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['key', 'value'] },
        },
      },
    },
    catalog_search: {
      type: 'OBJECT',
      description: 'Set ONLY to search the catalog before answering',
      properties: {
        text: { type: 'STRING' },
        category_id: { type: 'STRING' },
        filters: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['key', 'value'] },
        },
        min_price: { type: 'NUMBER' },
        max_price: { type: 'NUMBER' },
        currency: { type: 'STRING', description: 'ISO 4217 code of min_price/max_price when the customer states a currency (USD, PEN...)' },
      },
    },
    show_product_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Product ids to show with photo (carousel)' },
    cart_ops: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          op: { type: 'STRING', enum: ['add', 'set', 'remove'] },
          product_id: { type: 'STRING' },
          variant_name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
        },
        required: ['op', 'product_id'],
      },
    },
    order_action: { type: 'STRING', enum: ['none', 'show_cart', 'checkout'] },
  },
  required: ['reply', 'intent', 'language', 'confidence', 'handover', 'transfer_to_agent_id', 'booking_action'],
} as const

/** Output schema for an agent: real-estate lead agents also return lead_profile / capture. */
export function agentOutputSchema(industry: string | null | undefined, skills: string[]): Record<string, unknown> {
  if (!qualifiesLeads(industry, skills)) return AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>
  return {
    ...AGENT_OUTPUT_SCHEMA,
    properties: { ...AGENT_OUTPUT_SCHEMA.properties, lead_profile: LEAD_PROFILE_SCHEMA, capture: CAPTURE_SCHEMA },
  }
}

const TONES: Record<string, string> = {
  friendly: 'warm, friendly and close',
  professional: 'professional and clear',
  formal: 'formal and respectful (use "usted" in Spanish)',
  playful: 'playful and upbeat, light use of emojis',
  empathetic: 'empathetic, patient and reassuring',
  concise: 'brief and to the point',
  polite: 'polite and helpful',
}

const MAX_SLOT_LINES = 40
const SLOTS_PER_DAY = 8

export interface PromptInput {
  ctx: BusinessContext
  agent: AiAgentRow
  /** Agents this one may transfer to (already filtered). */
  transferTargets: AiAgentRow[]
  draft: BookingDraft | null
  /** Customer's upcoming bookings (for reschedule/cancel). */
  customerBookings: { id: string; booking_date: string; booking_time: string; service_name: string | null; staff_name: string | null }[]
  customerName: string | null
  channelLabel: string
  /** Results of a catalog search requested in the previous model turn. */
  catalogResults?: { query: string; products: import('./context').CatalogProduct[] } | null
  /** Current open cart of the conversation (orders skill). */
  cart?: { lines: { productId: string; name: string; quantity: number; unitPrice: number }[]; subtotal: number } | null
  /** Real estate: the customer's lead profile so far. */
  leadProfile?: Partial<LeadFields> | null
}

function money(ctx: BusinessContext, amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return formatMoney(Number(amount), ctx.workspace.currency, moneyLocale(ctx.workspace))
}

function availabilityBlock(input: PromptInput): string {
  const { ctx, draft } = input
  const preset = getPreset(ctx.workspace.industry)
  const now = zonedNow(ctx.timeZone)
  const service = ctx.services.find((s) => s.id === draft?.service_id)
  const duration = service?.duration_minutes ?? 30
  const q = {
    hours: ctx.hours,
    exceptions: ctx.exceptions,
    bookings: ctx.bookings,
    today: now.date,
    nowTime: now.time,
    durationMinutes: duration,
    stepMinutes: 30,
    capacity: Number((ctx.workspace.settings as { booking_capacity?: number })?.booking_capacity ?? 1),
  }
  const dates = draft?.date ? [draft.date] : upcomingDates(now.date, 7)
  const lines: string[] = []
  const staffPool = preset.bookingNeedsStaff || ctx.staff.length > 0
    ? ctx.staff.filter((s) => (!draft?.staff_id || s.id === draft.staff_id) && (!service || s.service_ids.length === 0 || s.service_ids.includes(service.id)))
    : []

  if (staffPool.length > 0) {
    for (const s of staffPool) {
      for (const d of dates) {
        const free = freeSlotsForStaff(s, d, q)
        if (free.length) lines.push(`- ${s.name} [${s.id}] ${weekdayOf(d)} ${d}: ${free.slice(0, SLOTS_PER_DAY).join(', ')}${free.length > SLOTS_PER_DAY ? ', …' : ''}`)
        if (lines.length >= MAX_SLOT_LINES) break
      }
    }
  } else {
    for (const d of dates) {
      const free = freeSlotsForBusiness(d, q)
      if (free.length) lines.push(`- ${weekdayOf(d)} ${d}: ${free.slice(0, SLOTS_PER_DAY).join(', ')}${free.length > SLOTS_PER_DAY ? ', …' : ''}`)
    }
  }
  return [
    `AVAILABLE START TIMES (for a ${duration}-minute ${service ? `"${service.name}"` : 'appointment'}; only these are bookable):`,
    lines.length ? lines.join('\n') : '- No availability in the next days.',
  ].join('\n')
}

/** System prompt for one agent turn. */
export function buildSystemPrompt(input: PromptInput): string {
  const { ctx, agent, draft } = input
  const ws = ctx.workspace
  const preset = getPreset(ws.industry)
  const { modules } = resolveIndustry(ws.industry, ws.settings)
  const locale = ws.locale
  const L = (k: Parameters<typeof industryLabel>[1]) => industryLabel(ws.industry, k, 'en', ws.settings)
  const skills = new Set(agent.skills)
  const now = zonedNow(ctx.timeZone)
  const canBook = skills.has('bookings') && modules.bookings
  const isRouter = skills.has('router')

  const sections: string[] = []

  sections.push(
    [
      `You are "${agent.name}", a virtual assistant of "${ws.name}" answering customers on ${input.channelLabel}.`,
      preset.ai.persona.en,
      agent.persona ? `Your personality: ${agent.persona}` : '',
      `Tone: ${TONES[agent.tone] ?? agent.tone}.`,
      agent.language === 'auto'
        ? `Always reply in the language the customer writes in (default ${locale === 'en' ? 'English' : 'Spanish'}).`
        : `Always reply in ${agent.language === 'en' ? 'English' : 'Spanish'}.`,
      /instagram|messenger/i.test(input.channelLabel)
        ? 'Write short chat messages. This channel shows text literally: do not use *bold*, _italics_ or other markup. Never invent information that is not in this prompt; if you do not know, say so and offer a human.'
        : 'Write short chat messages (WhatsApp style). Use *bold* sparingly. Never invent information that is not in this prompt; if you do not know, say so and offer a human.',
      'Never promise actions the system cannot do (e.g. notifying the customer later, holding stock, discounts, sending emails); offer a human instead.',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  if (agent.instructions?.trim()) sections.push(`OWNER INSTRUCTIONS (follow them):\n${agent.instructions.trim()}`)
  if (agent.training_context?.trim()) {
    sections.push(
      `BUSINESS KNOWLEDGE FROM THE OWNER (your main source: answer from it, never contradict it, never invent beyond it):\n${agent.training_context.trim()}`,
    )
  }

  const rules = preset.ai.rules.map((r) => `- ${r.en}`)
  if (rules.length) sections.push(`INDUSTRY RULES:\n${rules.join('\n')}`)

  sections.push(
    [
      'BUSINESS:',
      `- Name: ${ws.name}${ws.business_type_detail ? ` (${ws.business_type_detail})` : ''}`,
      ws.description ? `- About: ${ws.description}` : '',
      [ws.address, ws.city, ws.state].filter(Boolean).length ? `- Address: ${[ws.address, ws.city, ws.state].filter(Boolean).join(', ')}` : '',
      ws.google_map_link ? `- Map: ${ws.google_map_link}` : '',
      ws.phone ? `- Phone: ${ws.phone}` : '',
      ws.email ? `- Email: ${ws.email}` : '',
      ws.website ? `- Website: ${ws.website}` : '',
      `- Currency: ${ws.currency}`,
      `- Now: ${now.weekday} ${now.date} ${now.time} (${ctx.timeZone})`,
    ]
      .filter(Boolean)
      .join('\n'),
  )

  if (ctx.hours.length) {
    const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const rows = [...ctx.hours].sort((a, b) => order.indexOf(a.day_name) - order.indexOf(b.day_name))
    sections.push(
      'OPENING HOURS:\n' +
        rows
          .map((h) =>
            h.is_closed
              ? `- ${h.day_name}: closed`
              : `- ${h.day_name}: ${h.opening_time}–${h.closing_time}${h.break_start && h.break_end ? ` (break ${h.break_start}–${h.break_end})` : ''}`,
          )
          .join('\n'),
    )
  }
  const upcomingClosures = ctx.exceptions.filter((e) => e.date >= now.date).slice(0, 10)
  if (upcomingClosures.length) {
    sections.push(
      'SPECIAL DATES:\n' +
        upcomingClosures
          .map((e) => `- ${e.date}: ${e.is_closed ? 'closed' : `${e.opening_time}–${e.closing_time}`}${e.reason ? ` (${e.reason})` : ''}`)
          .join('\n'),
    )
  }

  if (modules.services && ctx.services.length) {
    sections.push(
      `${L('servicePlural').toUpperCase()} (id in brackets):\n` +
        ctx.services
          .map(
            (s) =>
              `- [${s.id}] ${s.name}: ${s.price_is_from ? 'from ' : ''}${money(ctx, s.price)}${s.duration_minutes ? `, ${s.duration_minutes} min` : ''}${s.description ? ` — ${s.description}` : ''}`,
          )
          .join('\n'),
    )
  }

  if (modules.staff && ctx.staff.length) {
    sections.push(
      `${L('staffPlural').toUpperCase()} (id in brackets):\n` +
        ctx.staff
          .map((s) => {
            const svc = s.service_ids.map((id) => ctx.services.find((x) => x.id === id)?.name).filter(Boolean)
            return `- [${s.id}] ${s.name}${s.title ? `, ${s.title}` : ''}${s.fee ? `, fee ${money(ctx, s.fee)}` : ''}${svc.length ? `, does: ${svc.join(', ')}` : ''}${s.bio ? ` — ${s.bio}` : ''}`
          })
          .join('\n'),
    )
  }

  const faqs = ctx.faqs.filter((f) => !f.ai_agent_ids?.length || f.ai_agent_ids.includes(agent.id))
  if (skills.has('faq') && faqs.length) {
    sections.push('FAQ (answer with these when relevant):\n' + faqs.slice(0, 60).map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n'))
  }

  if (canBook) {
    const fields = preset.bookingFields.filter((f) => f.type !== 'product')
    const fieldList = fields.map((f) => `${f.key} (${f.label.en}${f.required ? ', required' : ''})`).join(', ')
    sections.push(
      [
        `BOOKINGS ("${L('booking')}"):`,
        `- Collect step by step, one or two questions per message: ${modules.services && ctx.services.length ? 'service, ' : ''}${preset.bookingNeedsStaff && ctx.staff.length ? `${L('staff').toLowerCase()} (or "any"), ` : ''}date and time from AVAILABLE START TIMES${fieldList ? `, plus: ${fieldList}` : ''}.`,
        '- Put customer_name in booking.customer_name; other fields go in booking.fields as {key, value}. party_size goes in booking.party_size.',
        preset.bookingFields.some((f) => f.type === 'product')
          ? `- The ${L('booking').toLowerCase()} is about a specific ${L('product').toLowerCase()}: always put its id (from the catalog list or search results) in booking.product_id.`
          : '',
        '- Fill booking.* with everything known so far on EVERY turn (ids from the lists, dates YYYY-MM-DD, times HH:MM) and set booking_action="collecting".',
        '- When everything is known, summarize it and ask the customer to confirm. Only when the customer clearly confirms set booking_action="confirm" (the system will validate the slot and send the confirmation itself).',
        '- NEVER say the booking is confirmed, booked or scheduled yourself: only the system confirms. When you set booking_action="confirm" your reply text is not sent.',
        '- service_id and staff_id must be the ids in brackets from the lists above, not names.',
        '- To cancel an existing booking set booking_action="cancel" after the customer confirms which one.',
        input.customerBookings.length
          ? `- Customer's upcoming bookings: ${input.customerBookings.map((b) => `${b.booking_date} ${b.booking_time}${b.service_name ? ` ${b.service_name}` : ''}${b.staff_name ? ` with ${b.staff_name}` : ''}`).join('; ')}`
          : '',
        draft && Object.keys(draft).length ? `- Booking in progress: ${JSON.stringify(draft)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    sections.push(availabilityBlock(input))
  } else {
    sections.push('BOOKINGS: you cannot book. If asked, offer to pass the conversation to a human (handover=true).')
  }

  if ((skills.has('catalog') || skills.has('orders')) && modules.products) {
    const fields = productAttributesFor(ws.industry, ws.settings)
    const cat = ctx.catalog
    const catName = (id: string | null) => cat.categories.find((c) => c.id === id)?.name
    const line = (p: import('./context').CatalogProduct) => {
      const attrs = Object.entries(p.attributes ?? {})
        .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`)
        .join(', ')
      const stock = p.track_stock ? ((p.stock ?? 0) > 0 ? `stock ${p.stock}` : 'OUT OF STOCK') : ''
      return `- [${p.id}] ${p.name}: ${p.price === null ? 'price on request' : formatProductPrice(Number(p.price), p, ctx.workspace)}${catName(p.category_id) ? ` | ${catName(p.category_id)}` : ''}${attrs ? ` | ${attrs}` : ''}${stock ? ` | ${stock}` : ''}${p.images?.length ? ' | has photo' : ''}${p.description ? ` — ${p.description.slice(0, 160)}` : ''}`
    }
    const lines = [
      `CATALOG ("${L('productPlural')}", ${cat.total} active):`,
      cat.categories.length ? `- Categories: ${cat.categories.map((c) => `[${c.id}] ${c.name}`).join('; ')}` : '',
      fields.length
        ? `- Searchable attributes: ${fields
            .map((f) => `${f.key} (${f.type}${f.options ? `: ${f.options.map((o) => o.value).join('|')}` : ''}${f.unit ? `, ${f.unit}` : ''})`)
            .join('; ')}`
        : '',
      '- Only mention products, prices and stock that appear in this prompt. Never invent products. If something is out of stock, say so and suggest alternatives.',
      '- Each price carries its own currency (e.g. US$ vs S/): quote it exactly as shown and never convert between currencies.',
      skills.has('orders') && modules.orders
        ? '- To show products, put their ids in show_product_ids (up to 10, only "has photo"): they are sent as a swipeable carousel with photo, price and an "Add to cart" button. Prefer this when the customer browses, and then keep your reply to ONE short line (do not list the products or prices again).'
        : modules.bookings && preset.bookingFields.some((f) => f.type === 'product')
          ? `- To show ${L('productPlural').toLowerCase()}, put their ids in show_product_ids (up to 10, only "has photo"): they are sent as a swipeable carousel with photo, price and "Book a viewing" / "See details" buttons. Prefer this when the customer is browsing, and then keep your reply to ONE or TWO short lines (do not list the ${L('productPlural').toLowerCase()}, prices or features again; you may mention a mismatch with what they asked for).`
          : '- To show photos, put up to 3 product ids in show_product_ids (only products that "has photo").',
    ]
    if (input.catalogResults) {
      lines.push(
        `SEARCH RESULTS for "${input.catalogResults.query}":`,
        input.catalogResults.products.length ? input.catalogResults.products.map(line).join('\n') : '- No products matched. Say so and ask a clarifying question or suggest a broader search.',
        'Answer now using these results (do NOT set catalog_search again).',
      )
    } else if (cat.products) {
      lines.push('FULL CATALOG:', cat.products.map(line).join('\n'))
    } else if (cat.total > 0) {
      lines.push(
        '- The catalog is too large to list. When the customer asks about products, set catalog_search (text and/or category_id, filters as {key, value}; for numeric ranges use key "<attr>__min"/"<attr>__max"; min_price/max_price for price, plus currency when the customer states one, e.g. "hasta 300 mil dólares" → max_price=300000, currency="USD") and write a short placeholder reply; the system will run the search and ask you again with the results.',
      )
    } else {
      lines.push('- The catalog is empty: offer to connect with a human.')
    }
    sections.push(lines.filter(Boolean).join('\n'))
  }

  if (skills.has('orders') && modules.orders) {
    const cart = input.cart
    sections.push(
      [
        'ORDERS (shopping cart):',
        '- When the customer wants to buy, add items with cart_ops: {op:"add", product_id, quantity, variant_name?}; change with {op:"set", quantity}; remove with {op:"remove"}. Use ids from the catalog/search results only. The system validates price and stock and confirms each change itself, so keep your reply short (do not repeat prices or totals).',
        '- Set order_action="show_cart" when the customer asks to see the cart, and order_action="checkout" when they want to finish/pay. The system then asks for delivery method, address and name, shows the total and sends the payment options (QR / bank details) — do not collect those yourself.',
        '- Never say an order is placed or paid: only the system does that.',
        cart && cart.lines.length
          ? `- Current cart: ${cart.lines.map((l) => `${l.quantity}× ${l.name} [${l.productId}]`).join('; ')} (subtotal ${money(ctx, cart.subtotal)})`
          : '- The cart is empty.',
      ].join('\n'),
    )
  } else if (skills.has('orders')) {
    sections.push('ORDERS: online orders are turned off for this business; when the customer wants to buy, offer to pass the conversation to a human (handover=true).')
  }

  const leadAgent = qualifiesLeads(ws.industry, agent.skills)
  if (leadAgent) sections.push(...realEstateLeadSections(input.leadProfile, ws.currency))

  if (input.transferTargets.length) {
    sections.push(
      [
        isRouter
          ? 'ROUTING: your job is to understand what the customer needs and transfer them to the right agent as soon as it is clear. Ask one short clarifying question if needed. Do not try to solve the request yourself.'
          : 'TRANSFERS: if the customer needs something another agent handles better, transfer them.',
        'To transfer, set transfer_to_agent_id to the agent id and write a short reply announcing it. Agents:',
        ...input.transferTargets.map((a) => `- [${a.id}] ${a.name}: ${a.description || a.persona || '—'}`),
      ].join('\n'),
    )
  }

  sections.push(
    [
      'HUMAN HANDOVER:',
      skills.has('handover')
        ? '- Set handover=true when the customer asks for a person, is upset, or you cannot help. Reply that a team member will continue.'
        : '- Do not hand over to humans unless there is an emergency.',
      '- Set intent="emergency" and handover=true for emergencies.',
    ].join('\n'),
  )

  sections.push(
    [
      'OUTPUT: a JSON object with: reply, intent, language (ISO code of the customer language), confidence (0-1), handover, transfer_to_agent_id ("" if none), booking_action ("none" if not booking), booking (object, may be empty).',
      leadAgent ? 'Also lead_profile (object with only the facts the customer gave; {} if none) and capture (only for owners offering their property; omit otherwise).' : '',
      input.customerName ? `The customer's name on file is "${input.customerName}".` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  return sections.join('\n\n')
}
