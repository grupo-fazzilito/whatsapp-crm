# Pendientes para lanzar Whasalia

Lista viva: se actualiza con cada avance. Marca `[x]` lo terminado y anota la fecha.
**Quién:** 🧑 = Toño · 🤖 = Claude · 🧑→🤖 = Toño da los datos y Claude lo configura.

Última actualización: 2026-10-14

---

## 1. Dominio whasalia.com

- [x] Comprar `whasalia.com` (Namecheap) — 🧑
- [x] Agregar `whasalia.com` y `www.whasalia.com` en Railway + DNS + HTTPS — 🤖 (2026-10-12)
- [x] Nuevas URI de redireccionamiento y dominio en la app de Meta — 🧑 (2026-10-14)
- [x] `NEXT_PUBLIC_SITE_URL` y `BETTER_AUTH_URL` → `https://whasalia.com`; `www` y la dirección de Railway redirigen al dominio principal; cron apunta a whasalia.com — 🤖 (2026-10-14)
- [x] Meta → WhatsApp → Configuración → Webhook: URL `https://whasalia.com/api/webhooks/meta` (mismo token) — 🧑

## 2. Correo

- [x] Se deja Resend y se usa **MailerSend** (API HTTPS, porque Railway Hobby bloquea SMTP). El código ya envía por MailerSend con remitente `Whasalia <no-reply@whasalia.com>` — 🤖 (2026-10-26, rama `feat/mailersend`)
- [ ] Crear la cuenta de MailerSend y verificar el dominio `whasalia.com` (registros SPF/DKIM/Return-Path en Namecheap; no tocar los MX ni el DKIM de Private Email). **Bloquea el registro de clientes con email** — 🧑
- [ ] Crear un token de API (permiso «Email: acceso total») y ponerlo en Railway como `MAILERSEND_API_KEY`; quitar `SMTP_*` y `RESEND_API_KEY` si están. Remitente opcional en `MAIL_FROM` (por defecto `no-reply@whasalia.com`) — 🧑→🤖
- [ ] Probar en producción: registro con email, recuperar contraseña e invitación al equipo — 🤖
- [x] Correo del sitio cambiado a `support@whasalia.com` (contacto, pie de página, políticas, Libro de Reclamaciones y avisos de reclamos) — 🤖 (2026-10-14)
- [x] Buzón `support@whasalia.com` en Namecheap Private Email; DNS: raíz como ALIAS a Railway, MX, SPF, DKIM (`privateemail._domainkey`) y DMARC — 🧑 (2026-10-14)

## 3. Login con Facebook y Google

- [x] App de Meta creada, Facebook Login configurado, claves en Railway — 🧑→🤖 (2026-10-12)
- [x] Cuenta de revisión para Meta: `grupofazzilito+metareview@gmail.com` (negocio "Demo Store") — 🤖 (2026-10-12)
- [x] Pasar la app de Meta a modo **Activo** — 🧑
- [x] Enviar la revisión de la app (**en revisión** desde 2026-11-06); en el texto usar `https://whasalia.com/login` y `https://whasalia.com/en/...` — 🧑
- [ ] Crear cliente OAuth de Google (callback `https://whasalia.com/api/auth/callback/google`) y pasar Client ID/Secret — 🧑→🤖
- [ ] Al terminar la revisión de Meta: borrar la cuenta de revisión o cambiarle la contraseña — 🤖

## 4. Meta: WhatsApp, Instagram y Messenger para clientes reales

- [x] Verificación del negocio de Grupo Fazzilito E.I.R.L. (Ficha RUC + correo `@whasalia.com` o dominio verificado) — 🧑 (verificado el 2026-10-20)
- [x] WhatsApp: Meta marca "WhatsApp needs more information" tras la verificación; abrir el aviso en Centro de seguridad y responder lo que pida — 🧑
- [x] Agregar productos WhatsApp, Messenger e Instagram; crear configuración de Embedded Signup y de inicio de sesión para empresas — 🧑 (Claude da el paso a paso)
- [x] Superadmin → Ajustes → Meta: App ID, ES config ID, login config ID (en Railway solo está `META_APP_SECRET`) — 🧑→🤖
- [x] Revisión de permisos avanzados (**enviada, en revisión** desde 2026-11-06) (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`…) con video por permiso — 🧑 graba / 🤖 guion listo en `docs/meta-app-review.md`
- [x] **Respuestas a comentarios por palabra clave** (Instagram y Facebook): Automatizaciones → Comentarios; respuesta pública + mensaje privado que abre el chat en la bandeja — 🤖 (2026-10-14, rama `feat/comment-replies`)
- [x] Para que funcione con clientes reales: en la app de Meta agregar a la revisión `instagram_manage_comments`, `pages_read_engagement`, `pages_read_user_content` y `pages_manage_engagement` (video: comentar «precio» → respuesta pública + mensaje privado); si se usa una configuración de Facebook Login for Business, agregar esos permisos a la configuración — 🧑
- [x] En la app de Meta → Webhooks: objeto **Instagram** suscrito al campo `comments` y objeto **Page** al campo `feed` — 🧑
- [ ] Los negocios que ya conectaron Instagram/Facebook deben volver a conectar la cuenta para dar el permiso de comentarios — 🧑 (avisar)
- [x] **Clientes de WhatsApp con nombre de usuario (BSUID)**: se reciben y se responden aunque Meta no comparta el teléfono; cambios de número o de BSUID unen al mismo contacto — 🤖 (2026-10-20, rama `feat/whatsapp-bsuid`)
- [ ] Opcional: reservar el nombre de usuario de empresa de Whasalia en WhatsApp Manager (abierto desde el 29-jun-2026) — 🧑
- [x] **API de Marketing Messages**: las plantillas de marketing de números con los términos aceptados salen por `/marketing_messages`; el resto sigue por Cloud API; aviso en Canales — 🤖 (2026-10-20, rama `feat/whatsapp-marketing-messages`)
- [x] En la app de Meta → Webhooks → WhatsApp Business Account: suscribir el campo **`account_update`** (avisa cuando una empresa acepta los términos de marketing) — 🧑
- [ ] Avisar a las empresas que usan Difusiones que acepten los términos de Marketing Messages en WhatsApp Manager antes del **13-oct-2027** (desde esa fecha Meta rechaza marketing por Cloud API) — 🧑
- [ ] Antes del 13-oct-2027: quitar el respaldo por Cloud API para plantillas de marketing — 🤖
- [x] **Llamadas de WhatsApp, fase 1** (las atiende una persona desde la bandeja, WebRTC en el navegador); el modal de conexión explica coexistencia vs. solo API — 🤖 (2026-10-20, rama `feat/whatsapp-calls`)
- [x] En la app de Meta → Webhooks → WhatsApp Business Account: suscribir el campo **`calls`** — 🧑
- [ ] Probar una llamada real: número solo API con límite de 2.000+ destinatarios/día (o número de prueba de Meta), activar en Canales y llamar desde un celular — 🧑
- [ ] Confirmar la tarifa de Meta por llamadas entrantes (página de precios de Calling API) — 🧑/🤖
- [ ] Llamadas fase 2: que las atienda el agente de IA (voz en tiempo real; servicio de audio aparte y tokens por minuto) — 🤖 (futuro)
- [ ] Llamadas salientes (pedir permiso al cliente y llamar desde la bandeja) — 🤖 (futuro)
- [x] **Bandeja: atención requerida y panel con pestañas** — traspaso de la IA/flujo que asigna y avisa (persona, equipo o disponibles), «Atención requerida» en el menú y pestaña «Atención», panel derecho con Atención + Contacto/CRM, sonido y avisos del escritorio, campos personalizados en Ajustes, embudo de ventas por defecto — 🤖 (2026-10-21, rama `feat/inbox-contact-panel`)
- [ ] Avisos con Whasalia cerrado (web push con service worker) o por correo — 🤖 (si se pide)
- [x] **Super admin**: solo entra por `/admin-panel/login` (el login normal la rechaza) y nunca ve el CRM de un cliente; «Entrar como cliente» en Panel de admin → Clientes (sesión de 1 h, sin rastro para el cliente) con registro interno en Panel de admin → Access log — 🤖 (2026-10-22, rama `feat/admin-impersonation`)
- [x] **Notificaciones del super admin** (campanita del panel con sonido y aviso del escritorio; interruptores por evento en Ajustes → General): usuario/negocio nuevo, tickets, reclamos, pagos, tokens agotados/bajos, canal conectado — 🤖 (2026-10-22, rama `feat/admin-notifications`)
- [ ] Notificaciones del super admin **por correo** a support@whasalia.com (pago fallido, reclamo, ticket…), cuando MailerSend esté configurado — 🤖
- [ ] Borrar la tabla `portfolio_items` (el «Showcase Portfolio» de plantilla se eliminó el 2026-10-22) tras comprobar en producción que no tiene datos que guardar — 🤖

## 5. Precios: Free Forever + tokens de IA

- [x] Tabla `plans` ligada a cada negocio (`workspaces.plan_id`); un solo plan, **Free Forever** (`free`, S/ 0); la IA se paga aparte con tokens. Portada, Precios, preguntas frecuentes, términos y política de pagos y reembolsos; el plan se ve en Ajustes → Tokens — 🤖 (2026-10-14, rama `feat/free-forever`, falta fusionar)
- [ ] Cuando haya un plan pago: agregarlo a la tabla `plans`, permitir cambiar el plan de un negocio desde Superadmin y cobrar la mensualidad — 🤖
- [ ] Confirmar en Superadmin → Facturación el precio del token, packs, tokens de bienvenida y vencimiento (el sitio los muestra tal cual) — 🧑
- [ ] Pasarela de pago para los tokens (Payment Latam: tarjeta, Yape, Plin, transferencia). Configurar credenciales en Superadmin — 🧑→🤖
- [ ] **Cobro en Venezuela** (las tarjetas venezolanas casi no pasan por Payment Latam). Elegir una vía — 🧑 decide / 🤖 construye:
  - **Pago Móvil**: requiere una cuenta bancaria venezolana (socio o representante con RIF). Primero pago manual con comprobante y aprobación en Superadmin; luego verificación automática si el banco tiene API.
  - **Registrarnos en mispidi.com (SPIDI, Banco Sofitasa)** — encaja con la recarga de tokens: el cliente paga con Pago Móvil, débito inmediato o cripto; el monto se fija en USD y SPIDI liquida en **bolívares a una cuenta bancaria venezolana**. API (docs.mispidi.com): login → token; `POST /api/v1/ext/agreements`; `POST /api/v1/ext/payment-sessions/buttons` (monto, `success_url`, `webhook_url`) → `payment_url`; webhook `payment_session.paid` firmado (HMAC-SHA256, `spidi-signature`); confirmar con `GET /payment-sessions/status/{id}`. Sandbox: `sandbox.api.spidipagos.com` y simulador `sim.mispidi.com`; producción tras una reunión de certificación — 🤖 se integra como Payment Latam
  - Preguntar a `hola@mispidi.com`: ¿acepta una empresa peruana o hace falta RIF? ¿la cuenta de liquidación debe ser venezolana (propia o de un socio)? comisiones; credenciales de sandbox — 🧑
  - Mostrar precios en USD a los negocios de Venezuela. Consultar con el contador cómo facturar y declarar estos cobros en SUNAT.

## 6. Sitio y seguridad

- [x] Datos de Grupo Fazzilito E.I.R.L. (RUC, dirección) en pie de página, contacto y políticas; ley peruana; fuera "chatnexgen" — 🤖 (2026-10-12)
- [x] Fuera "Socio oficial de Meta" de todo el sitio (ahora "API oficial de WhatsApp Business"); página de Funciones reescrita solo con lo que existe — 🤖 (2026-10-14, rama `feat/honest-features`)
- [ ] Revisar contenido heredado de la plantilla en las demás páginas: Integraciones, Automatización con IA, Seguridad, Casos de éxito, "Nosotros", empleos en San Francisco, testimonios, página `/admin` con datos de ejemplo — 🤖 propone / 🧑 aprueba
- [x] Integración con **Calendly** (una cuenta por negocio; la IA reserva directo o envía enlace; citas y cancelaciones en ambos sentidos) — 🤖 (2026-10-14, rama `feat/calendly`)
- [x] Crear la app OAuth en developer.calendly.com y pegar Client ID, Client secret y Webhook signing key en Superadmin → Settings → Calendly — 🧑 (2026-10-23)
- [x] Agendar sin IA: paso «Agendar cita» en los flujos y botón «Enviar agenda» en la bandeja (el cliente elige día y hora tocando); las citas manuales de servicios vinculados también se reservan en Calendly — 🤖 (2026-10-23, rama `feat/booking-picker`)
- [x] Recordatorios de citas en Automatizaciones → Recordatorios: on/off y textos propios, botones Confirmo / Cambiar fecha, plantilla de utilidad creada y enviada a Meta sola para fuera de la ventana de 24 h, sin reintentos en cadena, 1 crédito por recordatorio — 🤖 (2026-10-23, rama `feat/reminder-templates`)
- [ ] (Mejora) Selector de citas con **WhatsApp Flows** (formulario nativo de Meta con calendario) en lugar de listas; requiere publicar cada formulario en Meta — 🤖
- [x] Pantalla para que cada negocio cree sus **claves de API y webhooks**: Ajustes → Integraciones (crear y revocar claves, endpoints con eventos, prueba, entregas y reenvío, rotar secreto) — 🤖 (2026-10-26, rama `feat/api-keys-screen`)
- [x] Página pública de **documentación de la API** en `/es/api-docs` y `/en/api-docs` (autenticación, permisos, errores, paginación, límites, todos los endpoints de `/api/v1` y los webhooks con verificación de firma), enlazada en el pie de página y desde Ajustes → Integraciones. Reemplaza la página heredada de la plantilla, que mostraba un dominio y un SDK inexistentes — 🤖 (2026-10-26, rama `feat/api-docs`)
- [ ] Botón "Crear bot de preguntas frecuentes" que arme un menú numerado gratis desde la lista de FAQs — 🤖, opcional
- [ ] Portfolio de Meta: verificación en dos pasos y un segundo administrador — 🧑
- [ ] Teléfono o WhatsApp de soporte, si se quiere mostrar — 🧑
- [x] **Libro de Reclamaciones virtual**: formulario en `/es/libro-de-reclamaciones`, enlace en el pie de cada página, constancia por correo, respuestas desde Superadmin → Complaints con plazo de 15 días hábiles — 🤖 (2026-10-14, rama `feat/complaints-book`, falta fusionar)
- [ ] Responder cada reclamación en Superadmin → Complaints dentro de 15 días hábiles (llega aviso a `support@whasalia.com`; requiere el buzón del punto 2) — 🧑

## 7. Registro y configuración asistida

- [x] Todos los botones del sitio dicen "Regístrate gratis" (fuera "Agendar demo" y "Contactar ventas"); dentro de la app, modal y opción en el menú "?" con la configuración asistida de S/ 250 por Google Meet que abre WhatsApp — 🤖 (2026-10-14, rama `feat/signup-and-setup-help`)
- [ ] Poner tu número de WhatsApp en Superadmin → Settings → Soporte (sin él no aparecen el modal ni la opción del menú) — 🧑

## 8. TikTok (mensajes directos)

- [ ] Crear cuenta de desarrollador y registrar la app "Whasalia" en business-api.tiktok.com/portal/apps, con permisos Account user, Get account media y Account comment — 🧑. **Rechazada el 2026-10-14 por "seguridad del dominio"**. Soporte (2026-10-23) pidió un Business Center verificado: **creado y verificado el 2026-11-03** con la Ficha RUC; se le envió el Business Center ID a soporte y se reenvió el perfil de desarrollador corregido. Soporte (2026-11-05) pidió que el correo de contacto del Business Center (BC 7699932007794507828, Verification > Business Info) coincida con el del desarrollador: cambiado a support@whasalia.com. Al alinearlo, el owner de la organización de desarrollador (Grupo Fazzilito EIRL, ID 7696564781498532870) quedó sin transferir: support@whasalia.com sale como Admin y la cuenta anterior ya no tiene acceso; se pidió a soporte que lo pongan como Owner. Falta su respuesta
- [ ] Solicitar el producto **Business Messaging API** con el texto de caso de uso que preparó Claude; esperar aprobación de TikTok — 🧑
- [ ] Tras la aprobación: activar el permiso "TikTok Accounts", poner la Redirect URL `https://whasalia.com/api/integrations/tiktok/callback` y pasar App ID y App Secret — 🧑→🤖
- [ ] Construir la conexión: botón "Conectar TikTok" por negocio (OAuth), recibir mensajes (webhook firmado), responder texto e imagen dentro de las 48 h, agente de IA y bandeja — 🤖 (empieza con la documentación oficial; se prueba al tener la app aprobada)
- [ ] Respuestas públicas a comentarios de TikTok por palabra clave (permisos **Account comment** y **Get account media**; TikTok no permite mensaje privado desde un comentario) — 🤖 (cuando la app esté aprobada)
- [ ] Tras la aprobación: volver a mencionar TikTok en la web (portada, features y precios; se quitó el "TikTok, próximamente" el 2026-10-15 porque los revisores rechazan sitios con "coming soon") — 🤖
- [ ] Cuenta de TikTok **Business** de prueba, fuera de la UE/Reino Unido, con "recibir mensajes de todos" activado — 🧑

## 8b. Telegram

- [x] Bot de Telegram como canal (Bot API oficial, gratis): el negocio pega el token de @BotFather en Canales → Telegram; texto, fotos, archivos, botones, carrusel, ubicación, agente de IA y bandeja — 🤖 (2026-11-03)
- [x] Pedir el número con el botón "Compartir mi número" de Telegram después de un pedido o una reserva por chat, si el contacto no tiene teléfono — 🤖
- [x] **Telegram Business**: el bot contesta los chats de la cuenta personal del dueño (Telegram Premium) como un canal aparte «Cuenta personal»; lo que el dueño escribe desde su app se ve en la Bandeja y pausa a la IA; botón «Actualizar conexión» para bots conectados antes — 🤖 (2026-11-04)
- [ ] Probar Telegram Business con una cuenta Premium real — 🧑
- [ ] Difusiones por Telegram (a quien ya le escribió al bot), con límites para evitar spam — 🤖
- [ ] Unir el contacto de Telegram con el de WhatsApp cuando el cliente comparte un número que ya existe (hoy solo se guarda el número en el contacto de Telegram) — 🤖
- [ ] Probar con un bot real en producción (crear uno en @BotFather y conectarlo) — 🧑

## 8c. Tienda online y venta en redes

- [x] Tienda pública por negocio (`/tienda/<slug>`): catálogo con búsqueda y categorías, ficha de producto con variantes, carrito lateral (drawer), checkout con datos del cliente, entrega y pago, y página del pedido con el QR y "Enviar comprobante por WhatsApp" — 🤖 (2026-11-04)
- [x] Perfiles de envío (gratis, precio fijo por envío, por rangos de peso; "gratis desde" opcional) y recojo en tienda; la tienda solo se publica con envío, método de pago y productos. Peso (kg) en productos y variantes — 🤖
- [x] Perfil "Pago de envío en destino" (el cliente paga el envío al courier) y cargos adicionales por pedido, obligatorios u opcionales (ej. empaquetado, envoltura de regalo) — 🤖 (2026-11-04)
- [x] Servicios en la tienda (módulo Servicios): foto, «mostrar en la tienda» y, por servicio, si el cliente reserva día y hora al comprar (crea la cita con el pedido) o se coordina después — 🤖 (2026-11-04)
- [x] Servicios pagados al reservar: con Yape, Plin o transferencia el cliente ve el QR y sube el comprobante en el mismo paso (sin comprobante no se reserva); o elige «Pagar en el local» — 🤖 (2026-11-04, rama `feat/service-pay-now`)
- [x] Dirección de la tienda editable (Tienda online → General → «Cambiar dirección», ej. whasalia.com/tienda/barberia-leo): sugerencia desde el nombre, aviso si está tomada; los links anteriores de la tienda y de propiedades redirigen a la nueva — 🤖 (2026-11-04, rama `feat/store-address`)
- [x] Visibilidad del stock en la tienda (ocultar, mostrar la cantidad o solo «¡Casi agotado!» bajo X unidades), en general y por producto; botón «Notifícame disponibilidad» en agotados (se puede apagar en general y por producto) que registra al cliente y abre su WhatsApp con el mensaje al negocio; módulo **Lista de espera** con «Avisar» por WhatsApp (texto en la ventana de 24 h, plantilla «Notificar llegada de stock» fuera de ella, que Whasalia deja lista y el negocio solo envía a Meta) — 🤖 (2026-11-04, rama `feat/stock-waitlist`)
- [ ] Opción para que el negocio desactive «Pagar en el local» en sus servicios (hoy siempre se ofrece) — 🤖
- [ ] Pago con tarjeta en línea al reservar (pasarela) — 🤖
- [ ] Pedidos por chat (IA y botones) con los mismos perfiles de envío y cargos: preguntar la zona y calcular el envío por peso (hoy usan el costo fijo de Pedidos y pagos) — 🤖
- [ ] Pago con tarjeta en la tienda (cada negocio con su propia cuenta en la pasarela) — 🤖 / 🧑
- [ ] Lista de departamentos / provincias / distritos del Perú en el checkout (hoy son campos de texto) — 🤖
- [ ] Que el agente de IA comparta el enlace de la tienda o de un producto cuando el cliente lo pida — 🤖
- [ ] Planificador de publicaciones (Instagram, Facebook, TikTok) con descripciones hechas por la IA y el enlace a la tienda; necesita `instagram_content_publish` y `pages_manage_posts` (segundo App Review de Meta) y la Content Posting API de TikTok — 🤖 / 🧑
- [x] Catálogo de WhatsApp por **feed de productos** (sin permisos nuevos de Meta): Tienda online → WhatsApp → «Crear enlace del feed» + guía paso a paso; Meta lee el CSV cada hora (Commerce Manager → Feed programado) y el negocio conecta el catálogo al número en WhatsApp Manager — 🤖 (2026-11-04, rama `feat/whatsapp-catalog`)
- [x] Catálogo de WhatsApp en tiempo real (Catalog API, opción avanzada en la misma pestaña): Tienda online → WhatsApp → conectar un catálogo existente o crear uno; se activan la tienda y el carrito en el chat. Cada cambio de producto, foto o stock (editor, importación, pedidos) se envía al instante por triggers + cola, y el cron reintenta. Whasalia es la fuente principal. Los carritos enviados por WhatsApp crean el pedido en Pedidos y el cliente recibe el link al checkout de la tienda para elegir envío y pago (completa ese mismo pedido) — 🤖 (2026-11-04, rama `feat/whatsapp-catalog`)
- [ ] Meta para el catálogo de WhatsApp: en la app de Meta agregar el caso de uso «Manage products with Catalog API», sumar `catalog_management` a la configuración de Embedded Signup (login_config) y pedirlo en App Review; los números ya conectados deben reconectarse para dar el permiso — 🧑
- [ ] Que la IA envíe fichas de producto del catálogo de WhatsApp (mensajes de producto / multiproducto) en lugar de tarjetas propias cuando el catálogo esté conectado — 🤖
- [ ] "Estado preparado": mandar cada día al dueño la imagen y el texto para su estado de WhatsApp (no hay API oficial de estados) — 🤖

## 9. Mantenimiento

- [x] Quitada la importación desde Mercado Libre y portales inmobiliarios; queda solo Catálogo → Importar (CSV / Excel) — 🤖 (2026-10-14, rama `feat/remove-portal-imports`)
- [ ] Borrar las tablas sin uso `portal_connections`, `portal_feeds`, `portal_import_runs` y el ajuste `mercadolibre` (se dejaron por si tenían datos; revisar en producción antes) — 🤖

- [ ] Revisar las 5 actualizaciones de dependabot pendientes — 🤖

---
- [ ] **Changelog público (/changelog) en pausa**: se vació el 2026-10-26 y la página, el enlace del pie y el sitemap están ocultos mientras no tenga entradas. Cuando el sistema esté 100 % en producción, reiniciarlo con una primera entrada de lanzamiento y volver a sumar una entrada por cada cambio visible — 🧑→🤖

## Orden sugerido

1.4 → 2.1 → 3.3 y 3.4 → 5 → 4.1
