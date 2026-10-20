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
- [ ] Meta → WhatsApp → Configuración → Webhook: URL `https://whasalia.com/api/webhooks/meta` (mismo token) — 🧑

## 2. Correo

- [ ] Verificar `whasalia.com` en Resend (registros DNS en Namecheap, en el subdominio `send` para no chocar con Private Email). **Bloquea el registro de clientes con email**: hoy los códigos salen de `onboarding@resend.dev`, que solo entrega al dueño de la cuenta Resend — 🧑→🤖
- [ ] Cambiar el remitente a `Whasalia <no-reply@whasalia.com>` — 🤖 (después del anterior)
- [x] Correo del sitio cambiado a `support@whasalia.com` (contacto, pie de página, políticas, Libro de Reclamaciones y avisos de reclamos) — 🤖 (2026-10-14)
- [x] Buzón `support@whasalia.com` en Namecheap Private Email; DNS: raíz como ALIAS a Railway, MX, SPF, DKIM (`privateemail._domainkey`) y DMARC — 🧑 (2026-10-14)

## 3. Login con Facebook y Google

- [x] App de Meta creada, Facebook Login configurado, claves en Railway — 🧑→🤖 (2026-10-12)
- [x] Cuenta de revisión para Meta: `grupofazzilito+metareview@gmail.com` (negocio "Demo Store") — 🤖 (2026-10-12)
- [ ] Pasar la app de Meta a modo **Activo** — 🧑
- [ ] Enviar la revisión de la app; en el texto usar `https://whasalia.com/login` y `https://whasalia.com/en/...` — 🧑
- [ ] Crear cliente OAuth de Google (callback `https://whasalia.com/api/auth/callback/google`) y pasar Client ID/Secret — 🧑→🤖
- [ ] Al terminar la revisión de Meta: borrar la cuenta de revisión o cambiarle la contraseña — 🤖

## 4. Meta: WhatsApp, Instagram y Messenger para clientes reales

- [x] Verificación del negocio de Grupo Fazzilito E.I.R.L. (Ficha RUC + correo `@whasalia.com` o dominio verificado) — 🧑 (verificado el 2026-10-20)
- [ ] WhatsApp: Meta marca "WhatsApp needs more information" tras la verificación; abrir el aviso en Centro de seguridad y responder lo que pida — 🧑
- [ ] Agregar productos WhatsApp, Messenger e Instagram; crear configuración de Embedded Signup y de inicio de sesión para empresas — 🧑 (Claude da el paso a paso)
- [ ] Superadmin → Ajustes → Meta: App ID, ES config ID, login config ID (en Railway solo está `META_APP_SECRET`) — 🧑→🤖
- [ ] Revisión de permisos avanzados (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`…) con video por permiso — 🧑 graba / 🤖 guion
- [x] **Respuestas a comentarios por palabra clave** (Instagram y Facebook): Automatizaciones → Comentarios; respuesta pública + mensaje privado que abre el chat en la bandeja — 🤖 (2026-10-14, rama `feat/comment-replies`)
- [ ] Para que funcione con clientes reales: en la app de Meta agregar a la revisión `instagram_manage_comments`, `pages_read_engagement`, `pages_read_user_content` y `pages_manage_engagement` (video: comentar «precio» → respuesta pública + mensaje privado); si se usa una configuración de Facebook Login for Business, agregar esos permisos a la configuración — 🧑
- [ ] En la app de Meta → Webhooks: objeto **Instagram** suscrito al campo `comments` y objeto **Page** al campo `feed` — 🧑
- [ ] Los negocios que ya conectaron Instagram/Facebook deben volver a conectar la cuenta para dar el permiso de comentarios — 🧑 (avisar)

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
- [ ] Crear la app OAuth en developer.calendly.com y pegar Client ID, Client secret y Webhook signing key en Superadmin → Settings → Calendly — 🧑
- [ ] Pantalla para que cada negocio cree sus **claves de API y webhooks** (la API y los textos existen, falta la pantalla; la página de Funciones ya lo menciona) — 🤖
- [ ] Botón "Crear bot de preguntas frecuentes" que arme un menú numerado gratis desde la lista de FAQs — 🤖, opcional
- [ ] Portfolio de Meta: verificación en dos pasos y un segundo administrador — 🧑
- [ ] Teléfono o WhatsApp de soporte, si se quiere mostrar — 🧑
- [x] **Libro de Reclamaciones virtual**: formulario en `/es/libro-de-reclamaciones`, enlace en el pie de cada página, constancia por correo, respuestas desde Superadmin → Complaints con plazo de 15 días hábiles — 🤖 (2026-10-14, rama `feat/complaints-book`, falta fusionar)
- [ ] Responder cada reclamación en Superadmin → Complaints dentro de 15 días hábiles (llega aviso a `support@whasalia.com`; requiere el buzón del punto 2) — 🧑

## 7. Registro y configuración asistida

- [x] Todos los botones del sitio dicen "Regístrate gratis" (fuera "Agendar demo" y "Contactar ventas"); dentro de la app, modal y opción en el menú "?" con la configuración asistida de S/ 250 por Google Meet que abre WhatsApp — 🤖 (2026-10-14, rama `feat/signup-and-setup-help`)
- [ ] Poner tu número de WhatsApp en Superadmin → Settings → Soporte (sin él no aparecen el modal ni la opción del menú) — 🧑

## 8. TikTok (mensajes directos)

- [ ] Crear cuenta de desarrollador y registrar la app "Whasalia" en business-api.tiktok.com/portal/apps, con permisos Account user, Get account media y Account comment — 🧑. **Rechazada el 2026-10-14 por "seguridad del dominio"** (dominio nuevo, sin correo propio). Ya hay correo con SPF/DKIM/DMARC: cambiar el correo de la cuenta a `support@whasalia.com`, abrir un ticket de desarrollador pidiendo nueva revisión y usar `https://whasalia.com/en/privacy-policy` y `https://whasalia.com/en/terms-of-service` en el texto de uso
- [ ] Solicitar el producto **Business Messaging API** con el texto de caso de uso que preparó Claude; esperar aprobación de TikTok — 🧑
- [ ] Tras la aprobación: activar el permiso "TikTok Accounts", poner la Redirect URL `https://whasalia.com/api/integrations/tiktok/callback` y pasar App ID y App Secret — 🧑→🤖
- [ ] Construir la conexión: botón "Conectar TikTok" por negocio (OAuth), recibir mensajes (webhook firmado), responder texto e imagen dentro de las 48 h, agente de IA y bandeja — 🤖 (empieza con la documentación oficial; se prueba al tener la app aprobada)
- [ ] Respuestas públicas a comentarios de TikTok por palabra clave (permisos **Account comment** y **Get account media**; TikTok no permite mensaje privado desde un comentario) — 🤖 (cuando la app esté aprobada)
- [ ] Tras la aprobación: volver a mencionar TikTok en la web (portada, features y precios; se quitó el "TikTok, próximamente" el 2026-10-15 porque los revisores rechazan sitios con "coming soon") — 🤖
- [ ] Cuenta de TikTok **Business** de prueba, fuera de la UE/Reino Unido, con "recibir mensajes de todos" activado — 🧑

## 9. Mantenimiento

- [x] Quitada la importación desde Mercado Libre y portales inmobiliarios; queda solo Catálogo → Importar (CSV / Excel) — 🤖 (2026-10-14, rama `feat/remove-portal-imports`)
- [ ] Borrar las tablas sin uso `portal_connections`, `portal_feeds`, `portal_import_runs` y el ajuste `mercadolibre` (se dejaron por si tenían datos; revisar en producción antes) — 🤖

- [ ] Revisar las 5 actualizaciones de dependabot pendientes — 🤖

---

## Orden sugerido

1.4 → 2.1 → 3.3 y 3.4 → 5 → 4.1
