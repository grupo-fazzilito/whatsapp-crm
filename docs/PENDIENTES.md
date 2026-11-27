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
- [ ] Probar Google Calendar en producción: conectar el **calendario del negocio** (Configuración → Integraciones), crear una cita y ver el evento; mover/borrar el evento en Google y ver la cita; un evento personal bloquea ese horario. Luego pasar la app de Google a «En producción» y pedir la verificación (video) — 🧑🤖
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
- [ ] Meta rechazó `pages_read_user_content` y `pages_manage_engagement` el 2026-11-18 (el video no mostraba la lectura en vivo ni el cambio de estado). Regrabar con el **Video 5** de `docs/meta-app-review.md` y volver a enviar solo esos dos permisos — 🧑
- [x] **Visor de comentarios** (Automatizaciones → Comentarios → "Comentarios de tus publicaciones"): elegir cuenta y publicación, leer los comentarios en vivo, responder como la cuenta y ocultar/mostrar, con estado Sin responder / Respondido / Oculto. Facebook, Instagram y TikTok (también en modo de prueba). Sin tokens — 🤖 (2026-11-18, rama `feat/comment-viewer`)
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
- [x] **Llamadas fase 2: las atiende un agente de IA** — en Canales → WhatsApp → «Configurar atención con IA»: solo personas, solo IA, IA por horario (fuera/dentro del horario de atención o un horario propio) o IA si nadie contesta en N segundos; agente, voz, saludo y duración máxima. Servicio de voz aparte en `voice/` (Python + Pipecat ⇄ OpenAI Realtime); herramientas: ver horarios, agendar/cancelar citas, buscar productos, pasar a una persona (crea la tarea «Devolver la llamada»); transcripción + resumen como nota interna; cobro `call_minute` (50 tokens/min por defecto, editable en Admin) — 🤖 (2026-11-25, rama `feat/ai-calls`)
- [ ] Desplegar el servicio de voz en Railway: servicio nuevo desde este repo con *Root Directory* `voice` (usa su Dockerfile); variables `VOICE_SERVICE_SECRET` (24+ caracteres, la misma en ambos servicios). En la app: `VOICE_SERVICE_URL` (URL privada del servicio de voz, p. ej. `http://voice.railway.internal:8000`) y la misma `VOICE_SERVICE_SECRET`; `VOICE_CALLBACK_URL` es opcional (sin ella el servicio de voz llama a la URL pública de la app). Opcional: `OPENAI_REALTIME_API_KEY` (si no, usa la clave de OpenAI del panel; una de OpenRouter no sirve) y `OPENAI_REALTIME_MODEL` (por defecto `gpt-realtime-2.1`) — 🧑/🤖
- [ ] Probar una llamada real atendida por la IA; si no hay audio (Railway no deja pasar el UDP), poner un servidor TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` en el servicio de voz) o mover el servicio de voz a un VPS — 🧑/🤖
- [ ] Ajustar el precio por minuto (`call_minute`) cuando se vea el costo real de OpenAI Realtime por minuto — 🧑
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

## 5b. Países: Perú, Venezuela y Estados Unidos

Cada cuenta tiene una región (`pe`, `ve`, `us`) con su moneda, precios y pasarela. La visita entra por su país (Cloudflare); fuera de Perú y Venezuela, EE. UU.

- [x] Regiones con moneda y pasarela: Perú en soles con Payment Latam, Venezuela en USD con Mispidi, EE. UU. y resto del mundo en USD con Stripe — 🤖 2026-11-23, rama `feat/regions`
- [x] Detección por país (encabezado `CF-IPCountry` de Cloudflare) en el proxy, guardada en la cookie `region`; selector de país sobre los precios de la web; portada y precios sin caché compartida — 🤖
- [x] Precios por país en Superadmin → Facturación (Venezuela y EE. UU. en USD); la cuenta guarda su región al crearse o al abrir Tokens por primera vez (las cuentas existentes quedaron en Perú) y solo el superadmin la cambia (Superadmin → Clientes) — 🤖
- [x] Mientras el sitio no esté detrás de Cloudflare (sin encabezado de país), la web y las cuentas nuevas se tratan como Perú — 🤖 2026-11-23
- [ ] **Poner Cloudflare delante de whasalia.com**: crear la cuenta, agregar el dominio, cambiar los nameservers en Namecheap a los de Cloudflare, proxy (nube naranja) activo en `@` y `www`, SSL "Full (strict)". Sin esto todos los visitantes ven precios de EE. UU. — 🧑
- [ ] Revisar los precios en USD de Venezuela y EE. UU. en Superadmin → Facturación (por defecto US$ 0.015 por token, mínimo US$ 15) — 🧑
- [ ] **Stripe (EE. UU. y resto del mundo)**: Stripe **no acepta empresas con sede en Perú**; hace falta una empresa en un país soportado, p. ej. una LLC en EE. UU. con Stripe Atlas (~US$ 500) y su cuenta bancaria. Abrir la cuenta, activar el modo de prueba y crear las claves (`STRIPE_SECRET_KEY`) y el webhook (`STRIPE_WEBHOOK_SECRET`) apuntando a `https://whasalia.com/api/billing/stripe/webhook`. Impuestos de venta en EE. UU.: activar Stripe Tax o ver con un contador — 🧑
- [x] Integración de Stripe para recargas de EE. UU. y resto del mundo: Checkout Session de pago único en USD, `client_reference_id` = pago, webhook `/api/billing/stripe/webhook` firmado (checkout.session.completed / async_payment_succeeded / expired y charge.refunded, que descuenta los tokens), confirmación leyendo la sesión en la API antes de dar los tokens, y confirmación automática al volver del pago — 🤖 2026-11-23, rama `feat/regions` (sin probar con claves reales)
- [ ] Probar Stripe en modo de prueba: poner `STRIPE_SECRET_KEY` (sk_test_…) y `STRIPE_WEBHOOK_SECRET` en Railway, crear el webhook en Stripe con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` y `charge.refunded`, y pagar con la tarjeta 4242 4242 4242 4242 desde una cuenta con región EE. UU. — 🧑🤖
- [ ] **Mispidi / SPIDI (Venezuela)**: pedir el alta (piden RIF, cuenta bancaria venezolana en bolívares y datos de Pago Móvil); confirmar si aceptan una empresa peruana o si hace falta entidad en Venezuela; usar el simulador sim.mispidi.com para desarrollar. Cobra en VES al tipo BCV con el monto en USD — 🧑
- [ ] Integrar Mispidi: login con token, botón de pago `POST /api/v1/ext/payment-sessions/buttons` (USD), webhook firmado (`spidi-signature`, evento `paid`) y verificación con `GET …/payment-sessions/status/{id}`; mostrar "Desarrollado por SPIDI" como piden para producción — 🤖 (cuando haya credenciales del simulador)
- [ ] Mientras no haya pasarela, en Venezuela y EE. UU. la recarga muestra "escríbenos y te ayudamos a recargar"; el superadmin puede sumar tokens a mano — 🧑
- [ ] Datos de facturación por país (hoy el formulario pide DNI/RUC de Perú) y comprobantes: SUNAT en Perú; Stripe emite el recibo; la factura y los impuestos de EE. UU. van por la LLC; Venezuela según el contador — 🧑🤖

## 5c. Plan de créditos

- [x] Plan gratis: hasta 500 envíos de difusión por ciclo mensual desde la fecha de registro (WhatsApp + Messenger; los fallidos no cuentan); plan pago sin límite. Barra de uso en Difusiones y aviso al pasarse — 🤖 (2026-11-27, rama `feat/free-broadcast-limit`)

**Whasalia se vende solo en Perú** (2026-11-26; Venezuela saldrá con otra marca y otra web). Plan gratis para siempre: **1 cuenta por servicio** (1 WhatsApp, 1 Instagram, 1 Facebook, 1 TikTok, 1 Telegram, 1 chat web) y los créditos de regalo. Plan con **Culqi, en soles: S/ 39.90 al mes por 1,000 créditos, cuentas ilimitadas**; si se acaban, la IA sigue con **créditos adicionales a S/ 14.90 por 1,000, prorrateados (solo lo usado)**, hasta el límite de consumo extra que elige el cliente (barra de 1,000 a 9,000, por defecto 9,000; puede escribir más). Lo extra se cobra en la factura del mes siguiente. Cada comentario respondido usa 1 crédito, con o sin plan. Los créditos no usados vencen al renovar. Precios editables en Superadmin → Facturación.

- [x] Slider de tokens con el precio mensual en la página de precios y en Configuración → Tokens; suscribirse (Stripe Checkout), cambiar de plan, portal de Stripe para tarjeta, facturas y cancelar — 🤖 2026-11-23, rama `feat/token-subscriptions` (reemplazado por el plan único, abajo)
- [x] Cada factura pagada (`invoice.paid`) se lee de la API de Stripe y da la cuota del mes una sola vez; al renovar vencen los tokens del mes anterior (migración 34: `token_subscriptions`, `subscription_invoices`) — 🤖
- [x] ~~Comentarios ilimitados con suscripción~~ (rama `feat/comments-unlimited`, 2026-11-26): revertido el mismo día, los comentarios vuelven a costar 1 crédito — 🤖
- [x] Plan único de US$ 9.90 / 1,000 créditos; límite de consumo extra (barra + campo) al suscribirse y en Configuración → Tokens; créditos adicionales al acabarse (lotes `overage`, serializados por negocio), notificación la primera vez del mes; al cerrar el mes (`invoice.created` del borrador de renovación) se cuenta lo usado, vence el resto y va como una línea prorrateada en esa factura; respaldo en el cron (mes sin cerrar → ítem pendiente para la siguiente) y factura final al cancelar; tabla de **Facturas** por mes (plan + créditos adicionales + enlace a la factura de Stripe) en Configuración → Tokens (migración 36) — 🤖 2026-11-26, rama `feat/credit-overage`
- [x] Plan gratis con 1 cuenta por servicio: bloqueo al conectar (Canales, Meta, WhatsApp, TikTok, Telegram Business), insignia **Principal** (la primera conectada de cada servicio); negocios gratis con cuentas de más: 30 días de aviso y luego el cron desconecta las adicionales (no reciben ni envían mensajes); al suscribirse vuelven solas. Superadmin → Clientes: «Cuentas ilimitadas sin plan (cortesía)». En producción, al 2026-11-26 ningún negocio tenía más de una cuenta por servicio — 🤖 2026-11-26, rama `feat/credit-overage`
- [x] **Culqi (Perú, soles)**: suscribirse con Culqi Checkout (la tarjeta se vuelve token en el navegador; nunca pasa por nuestro servidor), cliente + tarjeta guardada en Culqi, primer cobro de S/ 39.90; cada mes el cron cobra en un solo cargo el plan + los créditos adicionales del mes anterior; si la tarjeta rechaza: «pago pendiente», reintento diario, aviso, y a los 3 días vuelve al plan gratis; cambiar tarjeta (cobra al instante si estaba pendiente), cancelar (sigue hasta fin de mes y cobra solo lo extra) y reanudar; datos de facturación con dirección, ciudad y teléfono (los pide Culqi); precios en soles editables en Superadmin → Facturación (migración 37). Probado contra el modo de prueba de Culqi: alta S/ 39.90, renovación con 250 adicionales S/ 43.63, tarjeta sin fondos → pago pendiente — 🤖 2026-11-26, rama `feat/credit-overage`
- [x] Llaves de prueba de Culqi en Railway (`CULQI_PUBLIC_KEY`, `CULQI_SECRET_KEY`, sin redesplegar) y en `.env.local` — 🤖 2026-11-26
- [ ] Probar en el navegador el formulario de Culqi Checkout (suscribirse, cambiar tarjeta, cancelar) con las tarjetas de prueba (Visa 4111 1111 1111 1111, 09/30, CVV 123) — 🧑🤖
- [x] **3D Secure** con la librería Culqi3DS: al suscribirse se cobra el token (si Culqi responde `action_code: REVIEW`, se abre la verificación del banco y se reintenta con `authentication_3DS`), después se guarda la tarjeta. En la renovación automática, si el banco pide verificación, el plan queda en pago pendiente y el botón «Pagar ahora» la hace con una tarjeta nueva — 🤖
- [ ] Probar 3D Secure en el navegador con las tarjetas de prueba de Culqi (Visa 4456 5300 0000 1096, 07/30, CVV 111, correo de facturación `review@culqi.com`: pide código; 4456 5300 0000 1013: falla la verificación). En modo de prueba Culqi acepta cualquier resultado; en vivo lo valida el banco — 🧑🤖
- [ ] Preguntar a Culqi cómo marcar los cobros recurrentes a tarjeta guardada para que el banco no pida 3D Secure cada mes (en pruebas, la tarjeta 3DS pide verificación también al cobrar la tarjeta guardada) — 🧑
- [ ] Pasar a producción: cambiar en Railway `CULQI_PUBLIC_KEY` y `CULQI_SECRET_KEY` por las llaves live (`pk_live_…`, `sk_live_…`) cuando Culqi active la cuenta — 🧑
- [ ] ~~En Stripe: agregar al webhook~~ (no hace falta mientras Whasalia sea solo Perú; Stripe queda en el código para otra marca) En Stripe: agregar al webhook los eventos `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.paid` e `invoice.payment_failed` (**`invoice.created` es obligatorio** para que los créditos adicionales vayan en la factura de renovación); guardar una vez la configuración del **Customer portal** (Settings → Billing → Customer portal: permitir cancelar y actualizar tarjeta) — 🧑
- [ ] **Facturación electrónica (SUNAT)** para Perú: emitir boleta/factura por cada cobro mensual con el detalle (plan + créditos adicionales), con un proveedor OSE/PSE (p. ej. Nubefact) y los datos DNI/RUC del cliente que ya pedimos en Configuración → Tokens — 🧑🤖
- [ ] ~~Perú con Payment Latam~~: su API (Payin) no tiene cobro automático a una tarjeta guardada; reemplazado por Culqi — 🧑

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
- [x] **Archivos seguros** (2026-11-26, rama `fix/upload-security`): ningún archivo subido o recibido de un cliente (SVG, HTML, PNG falso) puede ejecutar código en el dominio de la app; las imágenes públicas se validan por sus bytes; Next.js 16.4.6 (fallo crítico de bypass del proxy), sharp 0.35.5 (fallos de libvips al procesar imágenes), SheetJS 0.20.3 (contaminación de prototipos al leer Excel) y el resto de `npm audit fix` — 🤖
- [ ] Activar la **CSP en modo obligatorio** (hoy está en «solo reportar»): pasar a nonces para quitar `'unsafe-inline'`/`'unsafe-eval'` de los scripts — 🤖
- [ ] Revisar `npm audit` una vez al mes (quedan 3 avisos en la herramienta de Prisma que solo corre al desplegar; se resuelven cuando Prisma publique la corrección) — 🤖
- [ ] Teléfono o WhatsApp de soporte, si se quiere mostrar — 🧑
- [x] **Libro de Reclamaciones virtual**: formulario en `/es/libro-de-reclamaciones`, enlace en el pie de cada página, constancia por correo, respuestas desde Superadmin → Complaints con plazo de 15 días hábiles — 🤖 (2026-10-14, rama `feat/complaints-book`, falta fusionar)
- [ ] Responder cada reclamación en Superadmin → Complaints dentro de 15 días hábiles (llega aviso a `support@whasalia.com`; requiere el buzón del punto 2) — 🧑

## 7. Registro y configuración asistida

- [x] Todos los botones del sitio dicen "Regístrate gratis" (fuera "Agendar demo" y "Contactar ventas"); dentro de la app, modal y opción en el menú "?" con la configuración asistida de S/ 250 por Google Meet que abre WhatsApp — 🤖 (2026-10-14, rama `feat/signup-and-setup-help`)
- [x] Asistente de configuración al registrarse (modal por pasos: negocio, contacto, horario, qué vendes, preguntas frecuentes y agente de IA, con «Lo configuraré luego»); solo para cuentas nuevas, se puede reabrir desde «Configura tu cuenta» en el inicio — 🤖 (2026-11-27, rama `feat/setup-wizard`)
- [ ] Probar el asistente de configuración con una cuenta nueva en producción (registro con correo y con Google) — 🧑
- [ ] Poner tu número de WhatsApp en Superadmin → Settings → Soporte (sin él no aparecen el modal ni la opción del menú) — 🧑

## 8. TikTok (comentarios y mensajes directos)

- [ ] Crear cuenta de desarrollador y registrar la app "Whasalia" en business-api.tiktok.com/portal/apps, con permisos Account user, Get account media y Account comment — 🧑. **Rechazada el 2026-10-14 por "seguridad del dominio"**. Soporte (2026-10-23) pidió un Business Center verificado: **creado y verificado el 2026-11-03** con la Ficha RUC (BC 7699932007794507828). Correo de contacto del BC alineado con el del desarrollador (support@whasalia.com, 2026-11-05). **Perfil de desarrollador aprobado el 2026-11-12.** Falta: que soporte ponga support@whasalia.com como Owner de la organización (Grupo Fazzilito EIRL, ID 7696564781498532870; hoy sale como Admin; se le enviaron capturas)
- [ ] App rechazada el 2026-11-12 porque falta el **Accounts API Access Application Form** (obligatorio para el permiso "TikTok Accounts"): llenarlo con support@whasalia.com, caso de uso (texto en inglés que preparó Claude) y el video grabado con el modo de prueba (ver abajo); luego volver a enviar la app — 🧑
- [x] Permiso **TikTok message management** aprobado el 2026-11-23 (no basta: la URL de autorización sigue sin `message.list.*` y TikTok responde "scope")
- [x] **Data Security and Privacy Review Intake Form** de Business Messaging enviado el 2026-11-23 (APAC, LATAM, METAP y Norteamérica sin EE. UU.) — 🧑
- [ ] Responder el cuestionario "TikTok/ByteDance Third-Party Due Diligence Questionnaire" (llega en ~10 días hábiles al correo de contacto del formulario); al aprobar, marcar el permiso **Business Messaging** en la app y fusionar `feat/tiktok-messaging` — 🧑
- [ ] Después: pedir EE. UU. con el mismo formulario ("I already have access… extend to the US"), revisión de EE. UU. y USDS Addendum — 🧑
- [ ] Tras la aprobación: en el portal poner la Redirect URL `https://whasalia.com/api/channels/tiktok/oauth/callback/` (con la barra final) y subir el logo de la app; en Railway poner `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` y `TIKTOK_AUTH_URL` (el "TikTok account holder authorization URL" del portal) — 🧑
- [x] Conexión de TikTok por negocio (Accounts API): botón "Continuar con TikTok" en Canales (OAuth oficial, token de 1 día que se renueva solo), videos en el selector de publicación y respuestas públicas a comentarios con las mismas reglas de Instagram/Facebook (webhook `comment.update` firmado) — 🤖 2026-11-12. **Modo de prueba** `TIKTOK_SANDBOX=true` (solo local, nunca en producción): cuenta, videos y comentarios de ejemplo + botón "Simular comentario en TikTok", para grabar el video de revisión
- [x] Rotación del refresh token de TikTok (correo de TikTok, obligatorio antes del 2027-01-31): una sola renovación a la vez por cuenta, se guarda siempre el refresh token nuevo y su vencimiento (`refresh_token_expires_in`); si vence o TikTok lo rechaza, el canal pide «volver a autorizar» — 🤖 2026-11-23, rama `fix/tiktok-token-rotation`
- [ ] Probar la conexión de TikTok con la API real cuando aprueben la app (OAuth, lista de videos, respuesta a un comentario real, llegada del webhook) y ajustar lo que difiera de la documentación — 🤖
- [x] Mensajes directos de TikTok (Business Messaging API), código listo sin probar con la API real: webhook `im_receive_msg`/`im_send_msg` firmado → Bandeja; respuesta con texto e imágenes JPG/PNG (hasta 3 MB) dentro de las 48 h; agente de IA; lo que el dueño escribe desde TikTok se ve en la Bandeja y pausa a la IA; recuadro en la tarjeta del canal con los pasos para el cliente y botón «Actualizar conexión» — 🤖 2026-11-23, rama `feat/tiktok-messaging`
- [ ] Tras fusionar `feat/tiktok-messaging`: copiar del portal la nueva **TikTok account holder authorization URL** (ya con los permisos de mensajes) a `TIKTOK_AUTH_URL` en Railway y pulsar «Actualizar conexión» en la tarjeta de @fazzilwood — 🧑
- [ ] Probar mensajes directos con la cuenta real: recibir texto e imagen, responder desde la Bandeja, agente de IA, y ver en los logs que llega `im_receive_msg` — 🧑🤖
- [ ] TikTok pide **Advanced Access** o **cuenta de empresa verificada** para mensajes (`has_advanced_access` en `/business/get/`), y una revisión de seguridad y privacidad de datos para cuentas fuera de EE. UU.; confirmar si aplica a @fazzilwood si los mensajes no llegan — 🧑
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
- [x] **Publicaciones** (módulo nuevo): foto, carrusel, historia y reel en Facebook, Instagram y estado de WhatsApp; publicar ahora o programar; texto con IA (1 token); automáticas al crear producto, al reponer stock y calendario semanal; aprobación configurable; segunda app de Meta solo para publicar — 🤖 (2026-11-06, rama `feat/social-posts`)
- [ ] Crear la **segunda app de Meta** (solo publicaciones): producto Facebook Login for Business, URI de redirección `https://whasalia.com/api/social/oauth/callback`, permisos `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`; poner App ID / Secret (y Config ID opcional) en Superadmin → Ajustes → Meta → «Meta: Publicaciones» — 🧑
- [ ] App Review de esa app (video: conectar página → crear publicación con foto → aparece en Facebook e Instagram; programar un reel) — 🧑 graba / 🤖 guion si se pide
- [ ] Probar en producción: foto, carrusel, reel e historia reales; estado de WhatsApp con un número propio y la plantilla «Estado listo para publicar» aprobada — 🧑
- [ ] TikTok en Publicaciones (Content Posting API) cuando TikTok apruebe la app — 🤖
- [x] **Mensajes de marketing por Messenger** (Marketing Message API): en Difusiones, conectar cuenta publicitaria, suscriptores (invitación automática, botón en la bandeja, importar de Meta), difusión con tarjeta (imagen, título, texto, botón), presupuesto y programación; regla de 1 mensaje cada 12 h; Difusiones vuelve al menú lateral — 🤖 (2026-11-06, rama `feat/messenger-marketing`)
- [ ] Meta (app de mensajería) para Messenger marketing: aceptar los términos en Messenger → Configuración de la API de Messenger → Avanzado («Marketing Message API for Messenger»); tener el nivel de acceso de la Marketing API; crear una configuración de Facebook Login for Business con **token de usuario del sistema** (no vence), activos **Páginas + Cuentas publicitarias** y permisos `ads_management`, `pages_messaging`, `paid_marketing_messages`; poner su ID en Superadmin → Ajustes → Meta → «Configuration ID: marketing de Messenger» — 🧑
- [ ] App Review de `ads_management` y `paid_marketing_messages` (video: suscribirse desde Messenger → crear difusión con tarjeta → llega al Messenger del cliente), cuando termine la revisión actual — 🧑
- [ ] En la app de Meta → Webhooks → objeto **Page**: suscribir el campo `messaging_optins`; las páginas ya conectadas deben volver a conectarse en Canales para recibirlo — 🧑
- [ ] Cada negocio necesita una cuenta publicitaria con método de pago (Meta cobra cada mensaje entregado); los clientes en UE, Reino Unido, Australia, Japón y Corea no pueden recibirlos — 🧑 (avisar)
- [x] Traducir el asistente de Difusiones de WhatsApp (lista, 4 pasos y detalle) y adaptarlo al modo claro — 🤖 (2026-11-06, rama `feat/broadcasts-i18n`)
- [ ] Difusiones de WhatsApp: la opción «Subir CSV» no tiene dónde subir el archivo (no deja avanzar); agregar la carga o quitar la opción — 🤖
- [x] **Origen del chat para siempre**: cada conversación guarda su red, cuenta y nombre; al eliminar un canal ya no aparece como WhatsApp (se marca «cuenta desconectada» y no deja responder por otra red); al reconectar la misma cuenta vuelve; un envío por WhatsApp ya no se queda con chats de Instagram/Messenger; migración 31 corrige los chats existentes — 🤖 (2026-11-10, rama `fix/chat-channel-origin`)
- [ ] Bandeja: botón «Continuar desde +51 …» en chats de un número de WhatsApp eliminado (abre el chat en el número conectado, con plantilla si pasaron 24 h) — 🤖
- [ ] Contactos: «Unir con otro contacto» (mismo cliente que escribe desde otra cuenta de Instagram/Messenger: junta historial y etiquetas) — 🤖
- [x] **El agente de IA registra en el CRM** (casilla «Registrar en el CRM» en cada agente, activa por defecto): guarda nombre, correo, teléfono, empresa y campos personalizados que da el cliente (si ya hay un dato distinto no lo reemplaza: va a «Más información del cliente», que se crea solo); abre y avanza el negocio según «Cuándo pasa un cliente a esta etapa» (✨ en cada etapa del embudo; nunca retrocede); pone etiquetas según «Cuándo la pone la IA»; crea tareas y deja nota resumen al pasar el chat a una persona. Cada acción cobra tokens («Acción de la IA en el CRM», editable en Superadmin). Hechos automáticos sin IA (y sin cobro): cita agendada/completada, pedido hecho/pagado mueven el negocio a la etapa marcada. El embudo «Ventas» viene configurado. Pantalla de Etiquetas traducida. Migración 32 — 🤖 (2026-11-10, rama `feat/ai-crm-actions`)
- [ ] Probar el registro en el CRM con conversaciones reales (datos, etapas, etiquetas, tareas) y ajustar las instrucciones si la IA registra de más o de menos — 🧑🤖
- [x] Catálogo de WhatsApp por **feed de productos** (sin permisos nuevos de Meta): Tienda online → WhatsApp → «Crear enlace del feed» + guía paso a paso; Meta lee el CSV cada hora (Commerce Manager → Feed programado) y el negocio conecta el catálogo al número en WhatsApp Manager — 🤖 (2026-11-04, rama `feat/whatsapp-catalog`)
- [x] Catálogo de WhatsApp en tiempo real (Catalog API, opción avanzada en la misma pestaña): Tienda online → WhatsApp → conectar un catálogo existente o crear uno; se activan la tienda y el carrito en el chat. Cada cambio de producto, foto o stock (editor, importación, pedidos) se envía al instante por triggers + cola, y el cron reintenta. Whasalia es la fuente principal. Los carritos enviados por WhatsApp crean el pedido en Pedidos y el cliente recibe el link al checkout de la tienda para elegir envío y pago (completa ese mismo pedido) — 🤖 (2026-11-04, rama `feat/whatsapp-catalog`)
- [ ] Meta para el catálogo de WhatsApp: en la app de Meta agregar el caso de uso «Manage products with Catalog API», sumar `catalog_management` a la configuración de Embedded Signup (login_config) y pedirlo en App Review; los números ya conectados deben reconectarse para dar el permiso — 🧑
- [ ] Que la IA envíe fichas de producto del catálogo de WhatsApp (mensajes de producto / multiproducto) en lugar de tarjetas propias cuando el catálogo esté conectado — 🤖
- [x] "Estado preparado": destino «Estado de WhatsApp» en Publicaciones (te llega la foto/video con el texto y una página para compartir en el estado) — 🤖 (2026-11-06)

## 9. Mantenimiento

- [x] Quitada la importación desde Mercado Libre y portales inmobiliarios; queda solo Catálogo → Importar (CSV / Excel) — 🤖 (2026-10-14, rama `feat/remove-portal-imports`)
- [ ] Borrar las tablas sin uso `portal_connections`, `portal_feeds`, `portal_import_runs` y el ajuste `mercadolibre` (se dejaron por si tenían datos; revisar en producción antes) — 🤖

- [ ] Revisar las 5 actualizaciones de dependabot pendientes — 🤖

---
- [ ] **Changelog público (/changelog) en pausa**: se vació el 2026-10-26 y la página, el enlace del pie y el sitemap están ocultos mientras no tenga entradas. Cuando el sistema esté 100 % en producción, reiniciarlo con una primera entrada de lanzamiento y volver a sumar una entrada por cada cambio visible — 🧑→🤖

## Orden sugerido

1.4 → 2.1 → 3.3 y 3.4 → 5 → 4.1
