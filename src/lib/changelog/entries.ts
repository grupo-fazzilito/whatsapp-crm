// Public changelog shown at /es/changelog and /en/changelog. Newest first.
// Add an entry with every user-visible change (one per release / PR).

export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ChangelogEntry {
  /** YYYY-MM-DD */
  date: string
  title: { es: string; en: string }
  changes: { kind: ChangeKind; es: string; en: string }[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-10',
    title: { es: 'Entra con Google o Facebook', en: 'Sign in with Google or Facebook' },
    changes: [
      { kind: 'new', es: 'Crea tu cuenta o inicia sesión con Google o Facebook, sin contraseña.', en: 'Create your account or sign in with Google or Facebook, no password needed.' },
      { kind: 'new', es: 'Si ya tenías cuenta con ese email, se vincula automáticamente.', en: 'If you already had an account with that email, it is linked automatically.' },
    ],
  },
  {
    date: '2026-10-10',
    title: { es: 'Plantillas de WhatsApp con vista previa y aprobación de Meta', en: 'WhatsApp templates with preview and Meta approval' },
    changes: [
      { kind: 'new', es: 'Editor de plantillas con vista previa de cómo las verá tu cliente en WhatsApp, sugerencias listas para usar y variables con nombre (Nombre del cliente, Número de pedido…).', en: 'Template editor with a preview of how your customer will see it in WhatsApp, ready-made suggestions and named variables (Customer name, Order number…).' },
      { kind: 'new', es: 'Envía tus plantillas a Meta para aprobación desde Whasalia; el estado (en revisión, aprobada o rechazada con su motivo) se actualiza solo.', en: 'Send your templates to Meta for approval from Whasalia; the status (in review, approved, or rejected with its reason) updates by itself.' },
      { kind: 'improved', es: 'Encabezados con imagen, video o documento, y botones de respuesta, enlace o llamada.', en: 'Headers with an image, video or document, and reply, link or call buttons.' },
      { kind: 'improved', es: 'Conectar WhatsApp, Instagram y Messenger muestra primero el botón directo «Conectar con Facebook».', en: 'Connecting WhatsApp, Instagram and Messenger shows the direct «Connect with Facebook» button first.' },
    ],
  },
  {
    date: '2026-10-10',
    title: { es: 'Menús numerados en los flujos', en: 'Numbered menus in flows' },
    changes: [
      { kind: 'new', es: 'Los menús de un flujo pueden enviarse como texto numerado («1. Ventas, 2. Soporte…») con hasta 10 opciones.', en: 'Flow menus can be sent as numbered text («1. Sales, 2. Support…») with up to 10 options.' },
      { kind: 'improved', es: 'Tus clientes pueden responder escribiendo el número («2», «dos», «opción 2») o el nombre de la opción, además de tocar el botón.', en: 'Customers can answer by typing the number («2», «two», «option 2») or the option name, as well as tapping the button.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Menú más simple, etiquetas y webhooks de plataforma', en: 'Simpler menu, tags and platform webhooks' },
    changes: [
      { kind: 'improved', es: 'Menú lateral más corto: Principal, Negocio, Herramientas (plegable) y Ajustes, con pestañas dentro de cada sección.', en: 'Shorter side menu: Main, Business, Tools (collapsible) and Settings, with tabs inside each section.' },
      { kind: 'improved', es: 'Todos los miembros del equipo pueden crear etiquetas desde la conversación.', en: 'Every team member can create tags from the conversation.' },
      { kind: 'fixed', es: 'Las pestañas de la ficha de contacto se desplazan cuando no caben en pantalla.', en: 'Contact detail tabs scroll when they don\'t fit on screen.' },
      { kind: 'new', es: 'Webhooks de plataforma en el panel de administración para tickets, pagos, usuarios, negocios y más.', en: 'Platform webhooks in the admin panel for tickets, payments, users, businesses and more.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Acceso al panel de administración', en: 'Admin panel sign-in' },
    changes: [
      { kind: 'fixed', es: 'El inicio de sesión del superadministrador ya no vuelve a la pantalla de login en producción.', en: 'Super admin sign-in no longer bounces back to the login page in production.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Sitio en español e inglés, ventanas laterales y chat de prueba', en: 'Spanish and English site, side panels and test chat' },
    changes: [
      { kind: 'new', es: 'Todas las páginas públicas están en español y en inglés, cada idioma con su propia dirección (/es y /en) para un mejor posicionamiento en Google.', en: 'Every public page is available in Spanish and English, each language with its own address (/es and /en) for better Google ranking.' },
      { kind: 'improved', es: 'Todas las ventanas se abren como un panel desde la derecha, con el título y los botones siempre visibles.', en: 'Every dialog opens as a panel from the right, with the title and buttons always visible.' },
      { kind: 'improved', es: 'El chat de prueba de los agentes se ajusta al alto de la pantalla y usa el fondo de WhatsApp.', en: 'The agent test chat fits the screen height and uses the WhatsApp background.' },
      { kind: 'improved', es: 'La pestaña «Equipo» de Ajustes ahora se llama «Miembros».', en: 'The Settings «Team» tab is now called «Members».' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Whasalia: nueva marca, idioma y correo', en: 'Whasalia: new brand, language and email' },
    changes: [
      { kind: 'new', es: 'La plataforma ahora se llama Whasalia, con logo nuevo.', en: 'The platform is now called Whasalia, with a new logo.' },
      { kind: 'new', es: 'Español por defecto y selector ES / EN en el sitio, en el inicio de sesión y en el panel.', en: 'Spanish by default and an ES / EN switcher on the site, sign-in pages and dashboard.' },
      { kind: 'fixed', es: 'El registro ya no se queda en «Enviando…»: los correos salen por Resend.', en: 'Sign-up no longer gets stuck on «Sending…»: emails go out through Resend.' },
      { kind: 'new', es: 'Modo de pruebas (DEV): el código de verificación se completa solo mientras la plataforma está en pruebas.', en: 'Test mode (DEV): the verification code fills in by itself while the platform is in testing.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Panel personalizable, visita guiada y soporte', en: 'Customizable dashboard, guided tour and support' },
    changes: [
      { kind: 'new', es: 'Panel con widgets que puedes agregar, quitar y ordenar: conversaciones atendidas, nuevos leads, mensajes sin responder, reservas, pedidos y más.', en: 'Dashboard with widgets you can add, remove and reorder: conversations handled, new leads, unanswered messages, bookings, orders and more.' },
      { kind: 'new', es: 'Pasos de configuración inicial que se marcan en verde, y widget de cuentas conectadas.', en: 'Getting-started steps that turn green, and a connected accounts widget.' },
      { kind: 'new', es: 'Visita guiada la primera vez que entras, que puedes repetir desde la barra superior.', en: 'Guided tour on your first visit, which you can replay from the top bar.' },
      { kind: 'new', es: 'Menú de ayuda «?»: crear tickets de soporte y chat en línea con el equipo de Whasalia.', en: '«?» help menu: create support tickets and chat live with the Whasalia team.' },
      { kind: 'improved', es: 'Los créditos de IA ahora se llaman Tokens.', en: 'AI credits are now called Tokens.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Agentes de IA', en: 'AI agents' },
    changes: [
      { kind: 'new', es: 'Crea agentes desde plantillas por tipo de negocio y entrénalos con hasta 5.000 caracteres de contexto.', en: 'Create agents from templates by type of business and train them with up to 5,000 characters of context.' },
      { kind: 'new', es: 'Chat de prueba que muestra cómo se verá cada respuesta en WhatsApp, Instagram, Messenger o el chat web.', en: 'Test chat that shows how each reply will look on WhatsApp, Instagram, Messenger or web chat.' },
    ],
  },
  {
    date: '2026-10-09',
    title: { es: 'Tokens prepagados y uso de WhatsApp', en: 'Prepaid tokens and WhatsApp usage' },
    changes: [
      { kind: 'new', es: 'Recarga de tokens de IA con Payment Latam (desde S/ 50, válidos por 6 meses).', en: 'Top up AI tokens with Payment Latam (from S/ 50, valid for 6 months).' },
      { kind: 'new', es: 'Contador de mensajes de WhatsApp en Reportes, con los mensajes gratis de Meta del mes.', en: 'WhatsApp message counter in Reports, including Meta’s free messages for the month.' },
    ],
  },
  {
    date: '2026-10-08',
    title: { es: 'Bandeja Pro, inmobiliarias y Google Calendar', en: 'Pro inbox, real estate and Google Calendar' },
    changes: [
      { kind: 'new', es: 'Ventana de 24 horas, asignación de conversaciones, CRM y reportes en la bandeja.', en: '24-hour window, conversation ownership, CRM and reports in the inbox.' },
      { kind: 'new', es: 'Asistencia de IA para responder, API pública y webhooks.', en: 'AI reply assistance, public API and webhooks.' },
      { kind: 'new', es: 'Conexión de WhatsApp con coexistencia: el número sigue funcionando en la app del celular.', en: 'WhatsApp connection with coexistence: the number keeps working in the phone app.' },
      { kind: 'new', es: 'Paquete para inmobiliarias y sincronización en ambos sentidos con Google Calendar.', en: 'Real-estate pack and two-way Google Calendar sync.' },
      { kind: 'new', es: 'Pedidos por chat: carrito, carrusel de productos, pago y panel de pedidos.', en: 'Orders by chat: cart, product carousel, checkout and orders panel.' },
    ],
  },
  {
    date: '2026-10-07',
    title: { es: 'Catálogo y seguimientos', en: 'Catalog and follow-ups' },
    changes: [
      { kind: 'new', es: 'Catálogo de productos que la IA consulta para responder.', en: 'Product catalog the AI looks up to answer.' },
      { kind: 'new', es: 'Seguimientos automáticos a clientes que dejaron de responder.', en: 'Automatic follow-ups to customers who stopped replying.' },
    ],
  },
  {
    date: '2026-10-06',
    title: { es: 'Plataforma multinegocio y omnicanal', en: 'Multi-business, omnichannel platform' },
    changes: [
      { kind: 'new', es: 'Varios negocios por cuenta, con equipo, roles e invitaciones.', en: 'Several businesses per account, with team, roles and invitations.' },
      { kind: 'new', es: 'WhatsApp, Instagram, Messenger y chat web en una sola bandeja.', en: 'WhatsApp, Instagram, Messenger and web chat in one inbox.' },
      { kind: 'new', es: 'Configuración según el tipo de negocio: clínicas, barberías, spas, academias, restaurantes, tiendas e inmobiliarias.', en: 'Setup by type of business: clinics, barbershops, spas, academies, restaurants, stores and real estate.' },
    ],
  },
]
