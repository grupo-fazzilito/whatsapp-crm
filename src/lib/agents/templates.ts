// Starting points for new AI agents ("Nuevo agente" menu). Pure.
// Every template only pre-fills the form; the business edits everything.

export type TemplateKey = 'receptionist' | 'sales' | 'real_estate' | 'support' | 'router' | 'blank'

export interface AgentTemplate {
  key: TemplateKey
  skills: string[]
  tone: string
  /** Module the template needs (hidden when it's off). */
  requires?: 'bookings' | 'products' | 'orders'
  /** Only for this industry. */
  industry?: string
  text: Record<'es' | 'en', { name: string; description: string; persona: string; greeting: string; training: string }>
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: 'receptionist',
    skills: ['faq', 'bookings', 'handover'],
    tone: 'friendly',
    requires: 'bookings',
    text: {
      es: {
        name: 'Recepcionista',
        description: 'Agenda citas, responde horarios, precios y ubicación.',
        persona: 'Amable, ordenada y resolutiva. Confirma siempre fecha, hora y nombre antes de reservar.',
        greeting: '¡Hola! 👋 Soy la recepcionista de {business}. ¿Quieres reservar una cita o tienes alguna consulta?',
        training: 'Ejemplo: Atendemos con reserva previa. Las cancelaciones se avisan con 24 horas. Estacionamiento gratuito en el local.',
      },
      en: {
        name: 'Receptionist',
        description: 'Books appointments and answers hours, prices and location.',
        persona: 'Kind, organized and efficient. Always confirms date, time and name before booking.',
        greeting: 'Hi! 👋 I am the receptionist of {business}. Would you like to book an appointment or ask something?',
        training: 'Example: Appointments only. Cancel at least 24 hours before. Free parking at the venue.',
      },
    },
  },
  {
    key: 'sales',
    skills: ['faq', 'catalog', 'orders', 'handover'],
    tone: 'friendly',
    requires: 'products',
    text: {
      es: {
        name: 'Vendedor',
        description: 'Muestra el catálogo, recomienda productos y toma pedidos.',
        persona: 'Entusiasta y servicial. Recomienda según lo que el cliente busca y guía hasta cerrar el pedido.',
        greeting: '¡Hola! 😊 Bienvenido a {business}. ¿Qué estás buscando hoy?',
        training: 'Ejemplo: Envíos a todo Lima en 24 horas (S/ 10). Pagos por Yape, Plin o transferencia. Cambios dentro de 7 días con boleta.',
      },
      en: {
        name: 'Sales assistant',
        description: 'Shows the catalog, recommends products and takes orders.',
        persona: 'Enthusiastic and helpful. Recommends based on what the customer wants and guides them to place the order.',
        greeting: 'Hi! 😊 Welcome to {business}. What are you looking for today?',
        training: 'Example: Delivery in 24 hours. Pay by card or bank transfer. Exchanges within 7 days with receipt.',
      },
    },
  },
  {
    key: 'real_estate',
    skills: ['faq', 'catalog', 'bookings', 'handover'],
    tone: 'professional',
    industry: 'real_estate',
    text: {
      es: {
        name: 'Asesor inmobiliario',
        description: 'Califica al interesado, muestra propiedades y agenda visitas.',
        persona: 'Profesional y cercano. Pregunta operación, zona, presupuesto y dormitorios antes de recomendar.',
        greeting: '¡Hola! 🏡 Soy el asesor de {business}. ¿Buscas comprar o alquilar?',
        training: 'Ejemplo: Trabajamos en Miraflores, San Isidro y Barranco. Comisión del 3% al cierre. Ayudamos con el crédito hipotecario.',
      },
      en: {
        name: 'Real estate advisor',
        description: 'Qualifies leads, shows properties and books viewings.',
        persona: 'Professional and warm. Asks for operation, area, budget and bedrooms before recommending.',
        greeting: 'Hi! 🏡 I am the advisor of {business}. Are you looking to buy or rent?',
        training: 'Example: We work in downtown and the north side. 3% commission at closing. We help with mortgages.',
      },
    },
  },
  {
    key: 'support',
    skills: ['faq', 'handover'],
    tone: 'empathetic',
    text: {
      es: {
        name: 'Soporte',
        description: 'Resuelve dudas y problemas; pasa a una persona cuando hace falta.',
        persona: 'Paciente y empático. Pide los datos necesarios y explica los pasos con claridad.',
        greeting: '¡Hola! Estoy aquí para ayudarte. Cuéntame qué pasó.',
        training: 'Ejemplo: Garantía de 6 meses. Para reclamos pedimos número de pedido y una foto del producto.',
      },
      en: {
        name: 'Support',
        description: 'Solves questions and issues; hands over to a person when needed.',
        persona: 'Patient and empathetic. Asks for the details needed and explains the steps clearly.',
        greeting: 'Hi! I am here to help. Tell me what happened.',
        training: 'Example: 6-month warranty. For claims we need the order number and a photo of the product.',
      },
    },
  },
  {
    key: 'router',
    skills: ['router', 'handover'],
    tone: 'friendly',
    text: {
      es: {
        name: 'Recepción (enrutador)',
        description: 'Saluda, entiende qué necesita el cliente y lo pasa al agente indicado.',
        persona: 'Breve y cordial. No resuelve consultas largas: deriva al agente que corresponde.',
        greeting: '¡Hola! Bienvenido a {business}. ¿En qué te podemos ayudar?',
        training: '',
      },
      en: {
        name: 'Front desk (router)',
        description: 'Greets, understands what the customer needs and hands over to the right agent.',
        persona: 'Brief and friendly. Does not handle long requests: routes to the right agent.',
        greeting: 'Hi! Welcome to {business}. How can we help you?',
        training: '',
      },
    },
  },
  {
    key: 'blank',
    skills: ['faq', 'handover'],
    tone: 'friendly',
    text: {
      es: { name: 'Nuevo agente', description: '', persona: '', greeting: '', training: '' },
      en: { name: 'New agent', description: '', persona: '', greeting: '', training: '' },
    },
  },
]

/** Templates that make sense for this workspace (industry + enabled modules). */
export function templatesFor(industry: string | null | undefined, modules: Partial<Record<'bookings' | 'products' | 'orders', boolean>>): AgentTemplate[] {
  return AGENT_TEMPLATES.filter((t) => (!t.industry || t.industry === industry) && (!t.requires || modules[t.requires]))
}

/** Body for POST /api/agents from a template. Skills that need a disabled module are dropped. */
export function agentFromTemplate(
  t: AgentTemplate,
  lang: 'es' | 'en',
  modules: Partial<Record<'bookings' | 'products' | 'orders', boolean>>,
): Record<string, unknown> {
  const x = t.text[lang]
  const skills = t.skills.filter(
    (s) => (s !== 'bookings' || modules.bookings) && (s !== 'catalog' || modules.products) && (s !== 'orders' || modules.orders),
  )
  return {
    name: x.name,
    description: x.description || null,
    persona: x.persona || null,
    tone: t.tone,
    skills,
    greeting_message: x.greeting || null,
    training_context: null,
    language: 'auto',
    enabled: true,
  }
}
