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
    date: '2026-10-23',
    title: { es: 'Agendar sin IA: desde un flujo o con un botón en la bandeja', en: 'Book without the AI: from a flow or with an inbox button' },
    changes: [
      { kind: 'new', es: 'Bandeja → botón «Enviar agenda» (ícono de calendario): el cliente elige el servicio, quién lo atiende, el día y la hora tocando opciones en el chat, y la cita se guarda sola. No usa la IA ni gasta créditos, ideal cuando atiende una persona.', en: 'Inbox → “Send schedule” button (calendar icon): the customer picks the service, who attends, the day and the time by tapping options in the chat, and the booking is saved on its own. It doesn’t use the AI or spend credits — ideal when a person handles the chat.' },
      { kind: 'new', es: 'Flujos: nuevo paso «Agendar cita» con el mismo selector y tres salidas (agendó, se envió el enlace de Calendly, no agendó) para seguir el flujo.', en: 'Flows: new “Book appointment” step with the same picker and three exits (booked, Calendly link sent, not booked) to continue the flow.' },
      { kind: 'improved', es: 'Las citas de servicios vinculados a Calendly se reservan en Calendly también desde un flujo, el botón de la bandeja o el formulario de citas; las demás se copian al Google Calendar de quien atiende.', en: 'Bookings of services linked to Calendly are booked in Calendly also from a flow, the inbox button or the bookings form; the rest are copied to the Google Calendar of whoever attends.' },
      { kind: 'improved', es: 'En el chat, los mensajes de los flujos y de la agenda automática ya no aparecen como «Agente IA».', en: 'In the chat, messages from flows and the automatic schedule no longer show as “AI agent”.' },
    ],
  },
  {
    date: '2026-10-22',
    title: { es: 'Nuevo logo, Google Calendar en Integraciones y ventanas más fluidas', en: 'New logo, Google Calendar in Integrations and smoother windows' },
    changes: [
      { kind: 'improved', es: 'Nuevo logo de Whasalia en la app, la web y el ícono de la pestaña del navegador.', en: 'New Whasalia logo across the app, the website and the browser tab icon.' },
      { kind: 'new', es: 'Ajustes → Integraciones: conecta Google Calendar para cada persona del equipo que recibe reservas, sin salir de la configuración.', en: 'Settings → Integrations: connect Google Calendar for each team member who takes bookings, right from the settings.' },
      { kind: 'improved', es: 'Todas las ventanas y paneles laterales se abren con la misma animación suave.', en: 'All dialogs and side panels open with the same smooth animation.' },
    ],
  },
  {
    date: '2026-10-22',
    title: { es: 'Bandeja a todo el ancho y modo claro más legible', en: 'Full-width inbox and more readable light mode' },
    changes: [
      { kind: 'improved', es: 'La bandeja usa todo el ancho de la pantalla, también con el menú contraído, sin márgenes vacíos a los lados.', en: 'The inbox uses the full screen width, also with the menu collapsed, with no empty margins at the sides.' },
      { kind: 'fixed', es: 'Modo claro: el color principal usa un tono más oscuro para que textos, enlaces y botones se lean bien sobre fondo blanco; también se corrigieron el aviso de canales sin conectar, las prioridades, las etiquetas, las horas de los mensajes y el selector de idioma.', en: 'Light mode: the main color uses a deeper shade so text, links and buttons read well on white; the no-channel notice, priorities, tags, message times and language switch were fixed too.' },
    ],
  },
  {
    date: '2026-10-21',
    title: { es: 'Menú contraíble y mejoras del modo claro', en: 'Collapsible menu and light mode fixes' },
    changes: [
      { kind: 'new', es: 'El menú de la izquierda se puede contraer para ver solo iconos (flecha junto al logo) y se recuerda en tu navegador.', en: 'The left menu can collapse to icons only (arrow next to the logo) and your browser remembers it.' },
      { kind: 'fixed', es: 'Modo claro: el chat seleccionado en la bandeja se marca en un tono suave y legible, la barra de etiquetas y Chat/Archivos ya no es negra, y los botones de Facebook y otros botones de color mantienen el texto blanco.', en: 'Light mode: the selected chat in the inbox uses a soft, readable highlight, the tags and Chat/Files bar is no longer black, and Facebook and other colored buttons keep their white text.' },
    ],
  },
  {
    date: '2026-10-21',
    title: { es: 'Bandeja: atención requerida, panel con pestañas y CRM', en: 'Inbox: attention needed, tabbed panel and CRM' },
    changes: [
      { kind: 'new', es: 'Cuando la IA pasa un chat a una persona, aparece «Atención requerida» debajo de Bandeja y en la nueva pestaña «Atención» de la lista; se quita cuando alguien del equipo responde, lo resuelve o lo devuelve a la IA.', en: 'When the AI hands a chat to a person, “Attention needed” shows under Inbox and in the new “Attention” tab of the list; it clears when a team member replies, resolves it or gives it back to the AI.' },
      { kind: 'new', es: 'Ese traspaso ahora siempre avisa: a la persona asignada o, si no hay nadie, a todos los disponibles. En cada agente de IA puedes elegir a quién asignar (una persona, un equipo o reparto automático).', en: 'That handover now always notifies: the assigned person or, if nobody is, everyone available. In each AI agent you can choose who gets it (a person, a team or automatic).' },
      { kind: 'new', es: 'Sonido y avisos del escritorio para chats asignados, transferidos o que te pasa la IA; actívalos desde la campanita.', en: 'Sound and desktop alerts for chats assigned, transferred or handed to you by the AI; turn them on from the bell.' },
      { kind: 'improved', es: 'Panel derecho del chat: arriba quién atiende (asignar, transferir y agente de IA) y pestañas Contacto (datos editables, etiquetas, notas) y CRM (negocios con su etapa, tareas, campos personalizados y pedidos). «Tomar la conversación» queda a la vista en la cabecera.', en: 'Chat side panel: who handles it at the top (assign, transfer and AI agent) and Contact (editable details, tags, notes) and CRM (deals with their stage, tasks, custom fields and orders) tabs. “Take over” stays in sight in the header.' },
      { kind: 'new', es: 'Ajustes → Campos personalizados: crea campos de texto, número, fecha, lista de opciones o sí/no para tus contactos.', en: 'Settings → Custom fields: create text, number, date, option list or yes/no fields for your contacts.' },
      { kind: 'new', es: 'Cada negocio empieza con un embudo de ventas listo (Nuevo lead → Contactado → Interesado → Propuesta → Negociación → Cierre).', en: 'Every business starts with a ready sales pipeline (New lead → Contacted → Interested → Proposal → Negotiation → Closing).' },
    ],
  },
  {
    date: '2026-10-21',
    title: { es: 'Arreglo en respuestas rápidas', en: 'Quick replies fix' },
    changes: [
      { kind: 'fixed', es: 'En la bandeja, el enlace «Gestionar respuestas rápidas» del menú que aparece al escribir / ya abre la configuración.', en: 'In the inbox, the “Manage quick replies” link in the menu that opens when you type / now opens the settings.' },
    ],
  },
  {
    date: '2026-10-20',
    title: { es: 'Llamadas de WhatsApp en la bandeja', en: 'WhatsApp calls in the inbox' },
    changes: [
      { kind: 'new', es: 'Tus clientes pueden llamarte por WhatsApp y la llamada suena en la bandeja: contesta desde el navegador con tu micrófono, silencia o cuelga, con la conversación del cliente a mano.', en: 'Customers can call you on WhatsApp and the call rings in the inbox: answer from the browser with your microphone, mute or hang up, with the customer’s conversation at hand.' },
      { kind: 'new', es: 'Cada llamada queda en la conversación (atendida, con su duración, o perdida) y en Reportes ves las llamadas recibidas, atendidas y perdidas.', en: 'Every call is logged in the conversation (answered, with its length, or missed), and Reports shows calls received, answered and missed.' },
      { kind: 'new', es: 'Actívalas en Canales → WhatsApp, opcionalmente solo en tu horario de atención. Requieren un número conectado solo a la API (no coexistencia).', en: 'Turn them on in Channels → WhatsApp, optionally only during business hours. They need a number connected only to the API (not coexistence).' },
      { kind: 'improved', es: 'Al conectar WhatsApp, el asistente explica las ventajas y desventajas de la coexistencia y de usar solo la API.', en: 'When connecting WhatsApp, the wizard explains the pros and cons of coexistence and of API only.' },
    ],
  },
  {
    date: '2026-10-20',
    title: { es: 'WhatsApp: mensajes de marketing optimizados', en: 'WhatsApp: optimized marketing messages' },
    changes: [
      { kind: 'new', es: 'Tus plantillas de marketing (difusiones, seguimientos, automatizaciones) se envían con la API de Marketing Messages de Meta, que optimiza la entrega. Mismo precio que antes.', en: 'Your marketing templates (broadcasts, follow-ups, automations) go out through Meta’s Marketing Messages API, which optimizes delivery. Same price as before.' },
      { kind: 'new', es: 'En Canales, cada número de WhatsApp muestra si ya está activa y cómo activarla: un administrador del negocio acepta los términos una vez en WhatsApp Manager. Mientras tanto, se siguen enviando como hasta ahora.', en: 'In Channels, each WhatsApp number shows whether it is active and how to turn it on: a business admin accepts the terms once in WhatsApp Manager. Until then, they keep going out as before.' },
    ],
  },
  {
    date: '2026-10-20',
    title: { es: 'WhatsApp: clientes con nombre de usuario', en: 'WhatsApp: customers with a username' },
    changes: [
      { kind: 'fixed', es: 'Los mensajes de clientes que usan nombre de usuario en WhatsApp y no comparten su teléfono ahora llegan a la bandeja, y puedes responderles igual que al resto.', en: 'Messages from WhatsApp customers who use a username and don’t share their phone now reach the inbox, and you can reply to them like anyone else.' },
      { kind: 'improved', es: 'Si un cliente cambia de número o de identificador en WhatsApp, sigue siendo el mismo contacto, con su historial.', en: 'If a customer changes their WhatsApp number or identifier, they stay the same contact, with their history.' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Importa tu catálogo desde CSV o Excel', en: 'Import your catalog from CSV or Excel' },
    changes: [
      { kind: 'improved', es: 'Para cargar productos o propiedades en bloque, usa Catálogo → Importar con un archivo CSV o Excel. Quitamos la importación desde Mercado Libre y portales inmobiliarios.', en: 'To load products or properties in bulk, use Catalog → Import with a CSV or Excel file. Importing from Mercado Libre and real-estate portals has been removed.' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Respuestas automáticas a comentarios', en: 'Automatic comment replies' },
    changes: [
      { kind: 'new', es: 'En Automatizaciones → Comentarios crea reglas por palabra clave: cuando alguien comenta «precio» en tu Instagram o Facebook, Whasalia responde el comentario y le escribe por privado.', en: 'In Automations → Comments, create keyword rules: when someone comments “price” on your Instagram or Facebook, Whasalia replies to the comment and messages them privately.' },
      { kind: 'new', es: 'La regla puede aplicarse a todas tus publicaciones o a una sola, con varias respuestas públicas que se alternan y el nombre de la persona.', en: 'A rule can apply to all your posts or just one, with several public replies that rotate and the person’s name.' },
      { kind: 'new', es: 'El mensaje privado abre la conversación en la bandeja, donde sigue tu agente de IA o tu equipo. Cada persona recibe respuesta una sola vez por publicación.', en: 'The private message opens the conversation in the inbox, where your AI agent or your team takes over. Each person is answered once per post.' },
      { kind: 'new', es: 'Cada comentario respondido usa 1 token. Si te quedas sin tokens, las respuestas se pausan y el comentario queda registrado.', en: 'Each answered comment uses 1 token. If you run out, replies pause and the comment is still logged.' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Conecta tu Calendly', en: 'Connect your Calendly' },
    changes: [
      { kind: 'new', es: 'En Ajustes → Integraciones conecta el Calendly de tu negocio y elige qué servicio reserva cada tipo de cita.', en: 'In Settings → Integrations, connect your business’s Calendly and choose which service each event type books.' },
      { kind: 'new', es: 'Tu agente de IA ofrece los horarios libres de Calendly y reserva en el chat; si tu plan de Calendly no lo permite, envía el enlace del horario elegido.', en: 'Your AI agent offers Calendly’s free times and books in the chat; if your Calendly plan doesn’t allow it, it sends the link to the chosen time.' },
      { kind: 'new', es: 'Las citas y cancelaciones hechas en Calendly aparecen en Whasalia, y las cancelaciones hechas en Whasalia se reflejan en Calendly.', en: 'Appointments and cancellations made in Calendly show up in Whasalia, and cancellations made in Whasalia reach Calendly.' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Regístrate gratis y configuración asistida', en: 'Free sign-up and assisted setup' },
    changes: [
      { kind: 'improved', es: 'El sitio te lleva directo a crear tu cuenta gratis; ya no hay que agendar una demo.', en: 'The site takes you straight to creating your free account; no demo booking needed.' },
      { kind: 'new', es: '¿Necesitas ayuda para empezar? Configuramos tu cuenta contigo por Google Meet por S/ 250. Escríbenos por WhatsApp desde el menú de ayuda (?).', en: 'Need help getting started? We set up your account with you over Google Meet for S/ 250. Message us on WhatsApp from the help menu (?).' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Libro de Reclamaciones virtual', en: 'Virtual Complaints Book' },
    changes: [
      { kind: 'new', es: 'Puedes registrar un reclamo o una queja desde el enlace «Libro de Reclamaciones» al pie de cada página. Recibes una constancia por correo con el número de tu hoja y la fecha límite de respuesta.', en: 'You can file a claim or complaint from the «Complaints Book» link at the bottom of every page. You get an emailed receipt with your form number and the answer deadline.' },
    ],
  },
  {
    date: '2026-10-14',
    title: { es: 'Whasalia es gratis para siempre', en: 'Whasalia is free forever' },
    changes: [
      { kind: 'new', es: 'Un solo plan, Free Forever: toda la plataforma sin mensualidad.', en: 'One plan, Free Forever: the whole platform with no monthly fee.' },
      { kind: 'improved', es: 'Solo pagas la IA, con tokens prepagados. La página de Precios muestra el precio del token y cuánto cuesta cada acción de IA.', en: 'You only pay for AI, with prepaid tokens. The Pricing page shows the token price and what each AI action costs.' },
      { kind: 'improved', es: 'En Ajustes → Tokens ves en qué plan está tu negocio.', en: 'Settings → Tokens shows which plan your business is on.' },
    ],
  },
  {
    date: '2026-10-12',
    title: { es: 'Nueva dirección: whasalia.com', en: 'New address: whasalia.com' },
    changes: [
      { kind: 'new', es: 'Whasalia ahora vive en whasalia.com. Las direcciones anteriores te llevan ahí automáticamente.', en: 'Whasalia now lives at whasalia.com. The previous addresses take you there automatically.' },
    ],
  },
  {
    date: '2026-10-12',
    title: { es: 'Datos de la empresa en el sitio', en: 'Company details on the site' },
    changes: [
      { kind: 'improved', es: 'El pie de página, la página de contacto y las políticas muestran a Grupo Fazzilito E.I.R.L., su RUC y su dirección en Huancayo, Perú.', en: 'The footer, the contact page and the policies show Grupo Fazzilito E.I.R.L., its RUC and its address in Huancayo, Peru.' },
      { kind: 'improved', es: 'Los términos y la política de privacidad se rigen por la ley peruana (incluida la Ley N.° 29733 de Protección de Datos Personales).', en: 'The terms and privacy policy are governed by Peruvian law (including Personal Data Protection Law No. 29733).' },
      { kind: 'improved', es: 'Las nuevas claves de la API empiezan por wsl_live_; las que ya tenías siguen funcionando.', en: 'New API keys start with wsl_live_; the ones you already have keep working.' },
    ],
  },
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
