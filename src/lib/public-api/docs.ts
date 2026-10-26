// Content of the public API docs page (/es/api-docs, /en/api-docs). Pure
// data, client-safe. Keep it in sync with src/app/api/v1 and the webhook
// triggers (webhook_on_* in Postgres) when either changes.

export type L = { es: string; en: string }

export interface DocParam {
  name: string
  type: string
  required?: boolean
  desc: L
}

export interface DocEndpoint {
  id: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  /** Scope that grants it (besides `write`, and `read` for GETs). */
  scope: string | null
  summary: L
  query?: DocParam[]
  body?: DocParam[]
  example?: string
}

export interface DocResource {
  id: string
  title: L
  intro?: L
  endpoints: DocEndpoint[]
}

export const API_BASE_PATH = '/api/v1'

const LIMIT_CURSOR: DocParam[] = [
  { name: 'limit', type: 'integer', desc: { es: '1 a 100 (por defecto 25).', en: '1 to 100 (default 25).' } },
  { name: 'cursor', type: 'string', desc: { es: 'El `next_cursor` de la página anterior.', en: 'The `next_cursor` of the previous page.' } },
]
const UPDATED_SINCE: DocParam = {
  name: 'updated_since',
  type: 'ISO 8601',
  desc: { es: 'Solo los cambiados desde esa fecha (para sincronizar).', en: 'Only those changed since that date (for syncing).' },
}

export const API_RESOURCES: DocResource[] = [
  {
    id: 'account',
    title: { es: 'Cuenta', en: 'Account' },
    endpoints: [
      {
        id: 'me',
        method: 'GET',
        path: '/me',
        scope: null,
        summary: {
          es: 'El negocio de la clave (id, nombre, moneda, zona horaria) y sus permisos. Úsalo para probar la conexión.',
          en: 'The key’s business (id, name, currency, time zone) and its scopes. Use it to test the connection.',
        },
        example: `{
  "data": {
    "workspace": { "id": "…", "name": "Barbería Demo", "industry": "barbershop", "currency": "PEN", "timezone": "America/Lima", "locale": "es" },
    "api_key": { "id": "…", "name": "n8n producción", "scopes": ["contacts", "messages:send"] }
  }
}`,
      },
    ],
  },
  {
    id: 'contacts',
    title: { es: 'Contactos y etiquetas', en: 'Contacts and tags' },
    endpoints: [
      {
        id: 'contacts-list',
        method: 'GET',
        path: '/contacts',
        scope: 'contacts',
        summary: { es: 'Lista los contactos, los más recientes primero.', en: 'Lists contacts, newest first.' },
        query: [
          { name: 'q', type: 'string', desc: { es: 'Busca por nombre.', en: 'Searches by name.' } },
          { name: 'phone', type: 'string', desc: { es: 'Busca por teléfono, con o sin código de país (sin paginación).', en: 'Looks up by phone, with or without country code (not paginated).' } },
          { name: 'email', type: 'string', desc: { es: 'Email exacto.', en: 'Exact email.' } },
          { name: 'tag_id', type: 'uuid', desc: { es: 'Solo los que tienen esa etiqueta.', en: 'Only those with that tag.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
        example: `{
  "data": [
    {
      "id": "…", "name": "Ana Torres", "phone": "+51987654321", "email": "ana@example.com", "company": null,
      "avatar_url": null, "tags": [{ "id": "…", "name": "VIP", "color": "#22c55e" }],
      "created_at": "2026-10-20T15:04:05.123Z", "updated_at": "2026-10-21T09:00:00.000Z"
    }
  ],
  "next_cursor": "WyIyMDI2LTEwLTIw…"
}`,
      },
      {
        id: 'contacts-create',
        method: 'POST',
        path: '/contacts',
        scope: 'contacts',
        summary: {
          es: 'Crea un contacto. Si ya existe uno con ese teléfono responde 409 `contact_exists` con su `contact_id`.',
          en: 'Creates a contact. If one with that phone exists it answers 409 `contact_exists` with its `contact_id`.',
        },
        body: [
          { name: 'name', type: 'string', desc: { es: 'Nombre (máx. 200).', en: 'Name (max 200).' } },
          { name: 'phone', type: 'string', desc: { es: 'Formato internacional (+51987654321); se normaliza.', en: 'International format (+51987654321); normalized.' } },
          { name: 'email', type: 'string', desc: { es: 'Email.', en: 'Email.' } },
          { name: 'company', type: 'string', desc: { es: 'Empresa.', en: 'Company.' } },
          { name: 'tags', type: 'string[]', desc: { es: 'Nombres de etiquetas; se crean si no existen.', en: 'Tag names; created when missing.' } },
        ],
        example: `curl -X POST https://whasalia.com/api/v1/contacts \\
  -H "Authorization: Bearer $WHASALIA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Ana Torres","phone":"+51 987 654 321","tags":["Web"]}'`,
      },
      { id: 'contacts-get', method: 'GET', path: '/contacts/{id}', scope: 'contacts', summary: { es: 'Un contacto con sus etiquetas.', en: 'One contact with its tags.' } },
      {
        id: 'contacts-update',
        method: 'PATCH',
        path: '/contacts/{id}',
        scope: 'contacts',
        summary: { es: 'Cambia nombre, teléfono, email o empresa (envía solo lo que cambia).', en: 'Changes name, phone, email or company (send only what changes).' },
        body: [
          { name: 'name', type: 'string', desc: { es: 'Nombre.', en: 'Name.' } },
          { name: 'phone', type: 'string | null', desc: { es: 'Teléfono.', en: 'Phone.' } },
          { name: 'email', type: 'string | null', desc: { es: 'Email.', en: 'Email.' } },
          { name: 'company', type: 'string | null', desc: { es: 'Empresa.', en: 'Company.' } },
        ],
      },
      { id: 'tags-list', method: 'GET', path: '/tags', scope: 'contacts', summary: { es: 'Todas las etiquetas del negocio.', en: 'All the business’s tags.' } },
      { id: 'contact-tags-list', method: 'GET', path: '/contacts/{id}/tags', scope: 'contacts', summary: { es: 'Las etiquetas de un contacto.', en: 'A contact’s tags.' } },
      {
        id: 'contact-tags-add',
        method: 'POST',
        path: '/contacts/{id}/tags',
        scope: 'contacts',
        summary: { es: 'Agrega una etiqueta por id, o por nombre (se crea si no existe).', en: 'Adds a tag by id, or by name (created when missing).' },
        body: [
          { name: 'tag_id', type: 'uuid', desc: { es: 'Etiqueta existente…', en: 'Existing tag…' } },
          { name: 'name', type: 'string', desc: { es: '…o su nombre.', en: '…or its name.' } },
          { name: 'color', type: '#rrggbb', desc: { es: 'Color si se crea.', en: 'Color when created.' } },
        ],
      },
      { id: 'contact-tags-remove', method: 'DELETE', path: '/contacts/{id}/tags/{tag_id}', scope: 'contacts', summary: { es: 'Quita la etiqueta del contacto.', en: 'Removes the tag from the contact.' } },
    ],
  },
  {
    id: 'conversations',
    title: { es: 'Conversaciones y mensajes', en: 'Conversations and messages' },
    intro: {
      es: 'Leer necesita el permiso `conversations`; enviar, `messages:send`. Las notas internas del equipo nunca salen por la API.',
      en: 'Reading needs the `conversations` scope; sending needs `messages:send`. The team’s internal notes never go out through the API.',
    },
    endpoints: [
      {
        id: 'conversations-list',
        method: 'GET',
        path: '/conversations',
        scope: 'conversations',
        summary: { es: 'Lista las conversaciones, las de actividad más reciente primero.', en: 'Lists conversations, most recently active first.' },
        query: [
          { name: 'status', type: 'open | pending | closed', desc: { es: 'Estado.', en: 'Status.' } },
          { name: 'channel', type: 'whatsapp | instagram | messenger | tiktok | webchat', desc: { es: 'Canal.', en: 'Channel.' } },
          { name: 'assigned', type: 'uuid | none | any', desc: { es: 'Asignada a esa persona, a nadie o a alguien.', en: 'Assigned to that person, to nobody or to anyone.' } },
          { name: 'contact_id', type: 'uuid', desc: { es: 'De ese contacto.', en: 'Of that contact.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
      },
      { id: 'conversations-get', method: 'GET', path: '/conversations/{id}', scope: 'conversations', summary: { es: 'Una conversación con su canal y contacto.', en: 'One conversation with its channel and contact.' } },
      {
        id: 'messages-list',
        method: 'GET',
        path: '/conversations/{id}/messages',
        scope: 'conversations',
        summary: { es: 'Mensajes de la conversación, los más recientes primero.', en: 'The conversation’s messages, newest first.' },
        query: [{ name: 'created_since', type: 'ISO 8601', desc: { es: 'Solo los posteriores a esa fecha.', en: 'Only those after that date.' } }, ...LIMIT_CURSOR],
      },
      {
        id: 'messages-send',
        method: 'POST',
        path: '/conversations/{id}/messages',
        scope: 'messages:send',
        summary: {
          es: 'Envía un mensaje al cliente por el canal de la conversación. Fuera de la ventana de respuesta (24 h en WhatsApp) solo sale una plantilla aprobada; si no, responde 422 `window_closed`.',
          en: 'Sends a message to the customer on the conversation’s channel. Outside the reply window (24 h on WhatsApp) only an approved template goes out; otherwise it answers 422 `window_closed`.',
        },
        body: [
          { name: 'type', type: 'text | media | template', required: true, desc: { es: 'Tipo de mensaje.', en: 'Message type.' } },
          { name: 'text', type: 'string', desc: { es: 'Para `text` (máx. 4096).', en: 'For `text` (max 4096).' } },
          { name: 'media_type', type: 'image | video | audio | document', desc: { es: 'Para `media`.', en: 'For `media`.' } },
          { name: 'url', type: 'https URL', desc: { es: 'Para `media`: archivo público.', en: 'For `media`: public file.' } },
          { name: 'caption, filename', type: 'string', desc: { es: 'Opcionales para `media`.', en: 'Optional for `media`.' } },
          { name: 'template_name', type: 'string', desc: { es: 'Para `template` (solo WhatsApp).', en: 'For `template` (WhatsApp only).' } },
          { name: 'language', type: 'string', desc: { es: 'Idioma de la plantilla; si falta se usa el de la plantilla guardada.', en: 'Template language; defaults to the saved template’s.' } },
          { name: 'params', type: 'string[]', desc: { es: 'Valores de {{1}}, {{2}}… del cuerpo.', en: 'Values for the body’s {{1}}, {{2}}…' } },
        ],
        example: `curl -X POST https://whasalia.com/api/v1/conversations/{id}/messages \\
  -H "Authorization: Bearer $WHASALIA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"template","template_name":"pedido_listo","params":["Ana","#1042"]}'`,
      },
    ],
  },
  {
    id: 'bookings',
    title: { es: 'Reservas y citas', en: 'Bookings' },
    intro: {
      es: 'Fechas y horas en la zona horaria del negocio (`GET /me`). Los ids de servicios y personal se ven en el panel.',
      en: 'Dates and times are in the business’s time zone (`GET /me`). Service and staff ids are shown in the dashboard.',
    },
    endpoints: [
      {
        id: 'bookings-list',
        method: 'GET',
        path: '/bookings',
        scope: 'bookings',
        summary: { es: 'Lista las reservas.', en: 'Lists bookings.' },
        query: [
          { name: 'date_from, date_to', type: 'YYYY-MM-DD', desc: { es: 'Rango de fechas.', en: 'Date range.' } },
          { name: 'status', type: 'pending | confirmed | completed | cancelled | no_show', desc: { es: 'Estado.', en: 'Status.' } },
          { name: 'staff_id, service_id, contact_id', type: 'uuid', desc: { es: 'Filtros.', en: 'Filters.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
      },
      {
        id: 'bookings-create',
        method: 'POST',
        path: '/bookings',
        scope: 'bookings',
        summary: {
          es: 'Crea una reserva. Por defecto revisa la disponibilidad como el agente de IA (horario, agenda del personal, Google Calendar); si el horario está ocupado responde 422 `slot_unavailable` con alternativas.',
          en: 'Creates a booking. By default it checks availability like the AI agent (hours, staff agenda, Google Calendar); if the time is taken it answers 422 `slot_unavailable` with alternatives.',
        },
        body: [
          { name: 'contact_id', type: 'uuid', required: true, desc: { es: 'Cliente.', en: 'Customer.' } },
          { name: 'date', type: 'YYYY-MM-DD', required: true, desc: { es: 'Día.', en: 'Day.' } },
          { name: 'time', type: 'HH:MM', required: true, desc: { es: 'Hora (24 h).', en: 'Time (24 h).' } },
          { name: 'service_id, staff_id, product_id, conversation_id', type: 'uuid', desc: { es: 'Opcionales.', en: 'Optional.' } },
          { name: 'customer_name', type: 'string', desc: { es: 'Nombre para la reserva.', en: 'Name for the booking.' } },
          { name: 'party_size', type: 'integer', desc: { es: 'Personas (restaurantes).', en: 'People (restaurants).' } },
          { name: 'fields', type: 'object', desc: { es: 'Datos extra que pide el negocio.', en: 'Extra data the business asks for.' } },
          { name: 'notes', type: 'string', desc: { es: 'Notas.', en: 'Notes.' } },
          { name: 'check_availability', type: 'boolean', desc: { es: '`false` la guarda tal cual (carga manual).', en: '`false` saves it as given (manual entry).' } },
          { name: 'duration_minutes, status', type: 'integer, pending | confirmed', desc: { es: 'Solo con `check_availability: false`.', en: 'Only with `check_availability: false`.' } },
        ],
      },
      { id: 'bookings-get', method: 'GET', path: '/bookings/{id}', scope: 'bookings', summary: { es: 'Una reserva.', en: 'One booking.' } },
      {
        id: 'bookings-update',
        method: 'PATCH',
        path: '/bookings/{id}',
        scope: 'bookings',
        summary: { es: 'Cambia el estado o las notas.', en: 'Changes the status or the notes.' },
        body: [
          { name: 'status', type: 'pending | confirmed | completed | cancelled | no_show', desc: { es: 'Nuevo estado.', en: 'New status.' } },
          { name: 'notes', type: 'string', desc: { es: 'Notas.', en: 'Notes.' } },
        ],
      },
    ],
  },
  {
    id: 'products',
    title: { es: 'Catálogo', en: 'Catalog' },
    endpoints: [
      {
        id: 'products-list',
        method: 'GET',
        path: '/products',
        scope: 'catalog',
        summary: { es: 'Lista los productos con sus variantes.', en: 'Lists products with their variants.' },
        query: [
          { name: 'q', type: 'string', desc: { es: 'Busca por nombre.', en: 'Searches by name.' } },
          { name: 'sku', type: 'string', desc: { es: 'SKU exacto.', en: 'Exact SKU.' } },
          { name: 'active', type: 'true | false', desc: { es: 'Activos o inactivos.', en: 'Active or inactive.' } },
          { name: 'category_id', type: 'uuid', desc: { es: 'Categoría.', en: 'Category.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
      },
      {
        id: 'products-create',
        method: 'POST',
        path: '/products',
        scope: 'catalog',
        summary: { es: 'Crea un producto. Los mismos campos sirven para editarlo con PATCH.', en: 'Creates a product. The same fields edit it with PATCH.' },
        body: [
          { name: 'name', type: 'string', required: true, desc: { es: 'Nombre.', en: 'Name.' } },
          { name: 'description', type: 'string', desc: { es: 'Descripción.', en: 'Description.' } },
          { name: 'price, compare_at_price', type: 'number', desc: { es: 'Precio y precio anterior, en la moneda del negocio.', en: 'Price and previous price, in the business’s currency.' } },
          { name: 'sku', type: 'string', desc: { es: 'Código.', en: 'Code.' } },
          { name: 'track_stock, stock', type: 'boolean, integer', desc: { es: 'Control de stock.', en: 'Stock tracking.' } },
          { name: 'images', type: 'string[]', desc: { es: 'URLs de imágenes (máx. 20).', en: 'Image URLs (max 20).' } },
          { name: 'tags', type: 'string[]', desc: { es: 'Etiquetas.', en: 'Tags.' } },
          { name: 'category_id', type: 'uuid', desc: { es: 'Categoría.', en: 'Category.' } },
          { name: 'attributes', type: 'object', desc: { es: 'Atributos del rubro (p. ej. m², dormitorios).', en: 'Industry attributes (e.g. m², bedrooms).' } },
          { name: 'is_active, is_featured', type: 'boolean', desc: { es: 'Visible y destacado.', en: 'Visible and featured.' } },
        ],
      },
      { id: 'products-get', method: 'GET', path: '/products/{id}', scope: 'catalog', summary: { es: 'Un producto.', en: 'One product.' } },
      { id: 'products-update', method: 'PATCH', path: '/products/{id}', scope: 'catalog', summary: { es: 'Edita un producto (envía solo lo que cambia).', en: 'Edits a product (send only what changes).' } },
    ],
  },
  {
    id: 'orders',
    title: { es: 'Pedidos', en: 'Orders' },
    endpoints: [
      {
        id: 'orders-list',
        method: 'GET',
        path: '/orders',
        scope: 'orders',
        summary: { es: 'Lista los pedidos con sus líneas.', en: 'Lists orders with their lines.' },
        query: [
          { name: 'status', type: 'pending | confirmed | preparing | ready | shipped | delivered | cancelled', desc: { es: 'Estado.', en: 'Status.' } },
          { name: 'payment_status', type: 'unpaid | awaiting_proof | proof_received | paid | refunded', desc: { es: 'Pago.', en: 'Payment.' } },
          { name: 'contact_id', type: 'uuid', desc: { es: 'Cliente.', en: 'Customer.' } },
          { name: 'created_since', type: 'ISO 8601', desc: { es: 'Creados desde esa fecha.', en: 'Created since that date.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
      },
      {
        id: 'orders-create',
        method: 'POST',
        path: '/orders',
        scope: 'orders',
        summary: { es: 'Crea un pedido con productos del catálogo; los precios salen del catálogo.', en: 'Creates an order with catalog products; prices come from the catalog.' },
        body: [
          { name: 'contact_id', type: 'uuid', required: true, desc: { es: 'Cliente.', en: 'Customer.' } },
          { name: 'fulfillment', type: 'pickup | delivery | dine_in', required: true, desc: { es: 'Entrega.', en: 'Fulfillment.' } },
          { name: 'items', type: '[{product_id, variant_id?, quantity}]', required: true, desc: { es: '1 a 100 líneas.', en: '1 to 100 lines.' } },
          { name: 'address, address_reference', type: 'string', desc: { es: 'Obligatoria para `delivery`.', en: 'Required for `delivery`.' } },
          { name: 'notes', type: 'string', desc: { es: 'Notas.', en: 'Notes.' } },
        ],
      },
      { id: 'orders-get', method: 'GET', path: '/orders/{id}', scope: 'orders', summary: { es: 'Un pedido.', en: 'One order.' } },
      {
        id: 'orders-update',
        method: 'PATCH',
        path: '/orders/{id}',
        scope: 'orders',
        summary: {
          es: 'Cambia el estado o marca el pedido como pagado. El cliente recibe un aviso en su chat salvo que envíes `notify: false`.',
          en: 'Changes the status or marks the order as paid. The customer gets a message in their chat unless you send `notify: false`.',
        },
        body: [
          { name: 'status', type: 'confirmed | preparing | ready | shipped | delivered | cancelled', desc: { es: 'Nuevo estado.', en: 'New status.' } },
          { name: 'reason', type: 'string', desc: { es: 'Motivo (p. ej. al cancelar).', en: 'Reason (e.g. when cancelling).' } },
          { name: 'payment_status', type: 'paid', desc: { es: 'Marca el pago.', en: 'Marks the payment.' } },
          { name: 'notify', type: 'boolean', desc: { es: 'Avisar al cliente (por defecto sí).', en: 'Notify the customer (default yes).' } },
        ],
      },
    ],
  },
  {
    id: 'crm',
    title: { es: 'CRM: oportunidades, tareas y equipo', en: 'CRM: deals, tasks and team' },
    endpoints: [
      { id: 'pipelines-list', method: 'GET', path: '/pipelines', scope: 'crm', summary: { es: 'Embudos con sus etapas (ids para las oportunidades).', en: 'Pipelines with their stages (ids for deals).' } },
      { id: 'members-list', method: 'GET', path: '/members', scope: 'crm', summary: { es: 'Personas activas del equipo: `user_id` para tareas, `profile_id` para oportunidades.', en: 'Active team members: `user_id` for tasks, `profile_id` for deals.' } },
      {
        id: 'deals-list',
        method: 'GET',
        path: '/deals',
        scope: 'crm',
        summary: { es: 'Lista las oportunidades.', en: 'Lists deals.' },
        query: [
          { name: 'pipeline_id, stage_id, contact_id', type: 'uuid', desc: { es: 'Filtros.', en: 'Filters.' } },
          { name: 'status', type: 'open | won | lost', desc: { es: 'Estado.', en: 'Status.' } },
          UPDATED_SINCE,
          ...LIMIT_CURSOR,
        ],
      },
      {
        id: 'deals-create',
        method: 'POST',
        path: '/deals',
        scope: 'crm',
        summary: { es: 'Crea una oportunidad (sin `stage_id` entra en la primera etapa).', en: 'Creates a deal (without `stage_id` it enters the first stage).' },
        body: [
          { name: 'pipeline_id', type: 'uuid', required: true, desc: { es: 'Embudo.', en: 'Pipeline.' } },
          { name: 'title', type: 'string', required: true, desc: { es: 'Título.', en: 'Title.' } },
          { name: 'stage_id', type: 'uuid', desc: { es: 'Etapa del embudo.', en: 'Pipeline stage.' } },
          { name: 'value, currency', type: 'number, ISO 4217', desc: { es: 'Monto.', en: 'Amount.' } },
          { name: 'contact_id, conversation_id', type: 'uuid', desc: { es: 'Vínculos.', en: 'Links.' } },
          { name: 'assigned_to', type: 'uuid', desc: { es: '`profile_id` de `GET /members`.', en: '`profile_id` from `GET /members`.' } },
          { name: 'expected_close_date', type: 'YYYY-MM-DD', desc: { es: 'Cierre estimado.', en: 'Expected close.' } },
          { name: 'notes', type: 'string', desc: { es: 'Notas.', en: 'Notes.' } },
        ],
      },
      { id: 'deals-get', method: 'GET', path: '/deals/{id}', scope: 'crm', summary: { es: 'Una oportunidad.', en: 'One deal.' } },
      {
        id: 'deals-update',
        method: 'PATCH',
        path: '/deals/{id}',
        scope: 'crm',
        summary: { es: 'Edita la oportunidad, la mueve de etapa o la cierra.', en: 'Edits the deal, moves it to another stage or closes it.' },
        body: [
          { name: 'stage_id', type: 'uuid', desc: { es: 'Otra etapa del mismo embudo.', en: 'Another stage of the same pipeline.' } },
          { name: 'status', type: 'open | won | lost', desc: { es: '`lost` exige `lost_reason`.', en: '`lost` requires `lost_reason`.' } },
          { name: 'title, value, currency, contact_id, conversation_id, assigned_to, notes, expected_close_date', type: '—', desc: { es: 'Como al crear.', en: 'As when creating.' } },
        ],
      },
      {
        id: 'tasks-list',
        method: 'GET',
        path: '/tasks',
        scope: 'crm',
        summary: { es: 'Lista las tareas.', en: 'Lists tasks.' },
        query: [
          { name: 'status', type: 'open | done | cancelled', desc: { es: 'Estado.', en: 'Status.' } },
          { name: 'assignee_user_id, contact_id, deal_id, conversation_id', type: 'uuid', desc: { es: 'Filtros.', en: 'Filters.' } },
          ...LIMIT_CURSOR,
        ],
      },
      {
        id: 'tasks-create',
        method: 'POST',
        path: '/tasks',
        scope: 'crm',
        summary: { es: 'Crea una tarea.', en: 'Creates a task.' },
        body: [
          { name: 'title', type: 'string', required: true, desc: { es: 'Título.', en: 'Title.' } },
          { name: 'description', type: 'string', desc: { es: 'Detalle.', en: 'Details.' } },
          { name: 'due_at', type: 'ISO 8601', desc: { es: 'Vencimiento.', en: 'Due date.' } },
          { name: 'priority', type: 'low | normal | high | urgent', desc: { es: 'Prioridad.', en: 'Priority.' } },
          { name: 'assignee_user_id', type: 'uuid', desc: { es: '`user_id` de `GET /members`.', en: '`user_id` from `GET /members`.' } },
          { name: 'contact_id, conversation_id, deal_id', type: 'uuid', desc: { es: 'Vínculos.', en: 'Links.' } },
        ],
      },
    ],
  },
]

export interface DocScope {
  scope: string
  desc: L
}

export const API_SCOPE_DOCS: DocScope[] = [
  { scope: 'read', desc: { es: 'Leer todo (todos los GET).', en: 'Read everything (every GET).' } },
  { scope: 'write', desc: { es: 'Leer y escribir todo.', en: 'Read and write everything.' } },
  { scope: 'contacts', desc: { es: 'Contactos y etiquetas.', en: 'Contacts and tags.' } },
  { scope: 'conversations', desc: { es: 'Leer conversaciones y mensajes.', en: 'Read conversations and messages.' } },
  { scope: 'messages:send', desc: { es: 'Enviar mensajes.', en: 'Send messages.' } },
  { scope: 'catalog', desc: { es: 'Catálogo de productos.', en: 'Product catalog.' } },
  { scope: 'orders', desc: { es: 'Pedidos.', en: 'Orders.' } },
  { scope: 'bookings', desc: { es: 'Reservas y citas.', en: 'Bookings.' } },
  { scope: 'crm', desc: { es: 'Oportunidades, tareas, embudos y equipo.', en: 'Deals, tasks, pipelines and team.' } },
]

export interface DocError {
  status: number
  codes: string
  desc: L
}

export const API_ERROR_DOCS: DocError[] = [
  { status: 400, codes: 'invalid_request, invalid_cursor, invalid_limit, invalid_date', desc: { es: 'Falta un dato o tiene mal formato.', en: 'Data is missing or malformed.' } },
  { status: 401, codes: 'unauthorized, key_revoked, key_expired', desc: { es: 'Clave ausente, inválida, revocada o vencida.', en: 'Missing, invalid, revoked or expired key.' } },
  { status: 403, codes: 'insufficient_scope', desc: { es: 'La clave no tiene el permiso necesario.', en: 'The key lacks the required scope.' } },
  { status: 404, codes: 'not_found', desc: { es: 'No existe en tu negocio.', en: 'It doesn’t exist in your business.' } },
  { status: 409, codes: 'contact_exists, closed…', desc: { es: 'Choca con el estado actual.', en: 'Conflicts with the current state.' } },
  { status: 422, codes: 'invalid_reference, slot_unavailable, window_closed…', desc: { es: 'Los datos son válidos pero no se pueden aplicar.', en: 'The data is valid but can’t be applied.' } },
  { status: 429, codes: 'rate_limited', desc: { es: 'Demasiadas peticiones; respeta `Retry-After`.', en: 'Too many requests; honor `Retry-After`.' } },
  { status: 500, codes: 'internal_error', desc: { es: 'Error nuestro; reintenta más tarde.', en: 'Our error; retry later.' } },
]

export interface DocEvent {
  type: string
  data: string
  desc: L
}

export const WEBHOOK_EVENT_DOCS: DocEvent[] = [
  { type: 'message.received', data: 'message, contact', desc: { es: 'Un cliente escribió.', en: 'A customer wrote.' } },
  { type: 'message.sent', data: 'message, contact', desc: { es: 'Salió un mensaje (equipo, IA, flujo o API).', en: 'A message went out (team, AI, flow or API).' } },
  { type: 'conversation.created', data: 'conversation, contact', desc: { es: 'Nueva conversación.', en: 'New conversation.' } },
  { type: 'conversation.assigned', data: 'conversation, assigned_user, previous_assigned_user_id', desc: { es: 'Se asignó a otra persona.', en: 'Assigned to someone else.' } },
  { type: 'conversation.resolved', data: 'conversation, resolved_by_user_id', desc: { es: 'Se cerró.', en: 'It was closed.' } },
  { type: 'contact.created', data: 'contact', desc: { es: 'Nuevo contacto.', en: 'New contact.' } },
  { type: 'contact.updated', data: 'contact, changed', desc: { es: 'Cambió un contacto (`changed` lista los campos).', en: 'A contact changed (`changed` lists the fields).' } },
  { type: 'order.created', data: 'order', desc: { es: 'Nuevo pedido.', en: 'New order.' } },
  { type: 'order.status_changed', data: 'order, previous_status', desc: { es: 'Cambió el estado del pedido.', en: 'The order’s status changed.' } },
  { type: 'order.paid', data: 'order, previous_payment_status', desc: { es: 'El pedido se marcó como pagado.', en: 'The order was marked as paid.' } },
  { type: 'booking.created', data: 'booking, contact', desc: { es: 'Nueva reserva.', en: 'New booking.' } },
  { type: 'booking.status_changed', data: 'booking, previous_status', desc: { es: 'Cambió el estado de la reserva.', en: 'The booking’s status changed.' } },
  { type: 'lead.qualified', data: 'lead, contact', desc: { es: 'La IA calificó un lead (inmobiliaria).', en: 'The AI qualified a lead (real estate).' } },
  { type: 'deal.stage_changed', data: 'deal, from_stage, to_stage, pipeline', desc: { es: 'Una oportunidad cambió de etapa.', en: 'A deal changed stage.' } },
  { type: 'ping', data: 'message, endpoint_id', desc: { es: 'El botón «Enviar prueba».', en: 'The “Send test” button.' } },
]

export const WEBHOOK_VERIFY_NODE = `import crypto from 'node:crypto'

// rawBody: the request body exactly as received (string), before JSON.parse
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false // older than 5 min
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex')
  const given = Buffer.from(parts.v1 ?? '', 'hex')
  return given.length === 32 && crypto.timingSafeEqual(given, Buffer.from(expected, 'hex'))
}

// verify(rawBody, req.headers['x-whasalia-signature'], process.env.WHASALIA_WEBHOOK_SECRET)`

export const WEBHOOK_ENVELOPE = `POST https://tu-servidor.com/whasalia
Content-Type: application/json
User-Agent: Whasalia-Webhooks/1.0
X-Whasalia-Event: message.received
X-Whasalia-Delivery: 6f1c…            (id de la entrega / delivery id)
X-Whasalia-Signature: t=1792512000,v1=5d2a…

{
  "id": "evt_8b0f…",                    (mismo en reintentos / same on retries)
  "type": "message.received",
  "created_at": "2026-10-26T15:00:00.000Z",
  "workspace_id": "…",
  "data": {
    "message": { "id": "…", "conversation_id": "…", "direction": "inbound", "type": "text", "text": "Hola", … },
    "contact": { "id": "…", "name": "Ana Torres", "phone": "+51987654321", … }
  }
}`
