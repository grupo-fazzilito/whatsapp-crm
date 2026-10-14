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

- [ ] Verificar `whasalia.com` en Resend (registros DNS en Namecheap). **Bloquea el registro de clientes con email**: hoy los códigos salen de `onboarding@resend.dev`, que solo entrega al dueño de la cuenta Resend — 🧑→🤖
- [ ] Cambiar el remitente a `Whasalia <no-reply@whasalia.com>` — 🤖 (después del anterior)
- [ ] Crear buzón real (ej. `soporte@whasalia.com`, Zoho gratis o Google Workspace) y ponerlo en el sitio en lugar de `grupofazzilito@gmail.com` (se cambia en `src/lib/company/index.ts`) — 🧑→🤖

## 3. Login con Facebook y Google

- [x] App de Meta creada, Facebook Login configurado, claves en Railway — 🧑→🤖 (2026-10-12)
- [x] Cuenta de revisión para Meta: `grupofazzilito+metareview@gmail.com` (negocio "Demo Store") — 🤖 (2026-10-12)
- [ ] Pasar la app de Meta a modo **Activo** — 🧑
- [ ] Enviar la revisión de la app; en el texto usar `https://whasalia.com/login` y `https://whasalia.com/en/...` — 🧑
- [ ] Crear cliente OAuth de Google (callback `https://whasalia.com/api/auth/callback/google`) y pasar Client ID/Secret — 🧑→🤖
- [ ] Al terminar la revisión de Meta: borrar la cuenta de revisión o cambiarle la contraseña — 🤖

## 4. Meta: WhatsApp, Instagram y Messenger para clientes reales

- [ ] Verificación del negocio de Grupo Fazzilito E.I.R.L. (Ficha RUC + correo `@whasalia.com` o dominio verificado) — 🧑
- [ ] Agregar productos WhatsApp, Messenger e Instagram; crear configuración de Embedded Signup y de inicio de sesión para empresas — 🧑 (Claude da el paso a paso)
- [ ] Superadmin → Ajustes → Meta: App ID, ES config ID, login config ID (en Railway solo está `META_APP_SECRET`) — 🧑→🤖
- [ ] Revisión de permisos avanzados (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`…) con video por permiso — 🧑 graba / 🤖 guion

## 5. Precios: Free Forever + tokens de IA

- [x] Tabla `plans` ligada a cada negocio (`workspaces.plan_id`); un solo plan, **Free Forever** (`free`, S/ 0); la IA se paga aparte con tokens. Portada, Precios, preguntas frecuentes, términos y política de pagos y reembolsos; el plan se ve en Ajustes → Tokens — 🤖 (2026-10-14, rama `feat/free-forever`, falta fusionar)
- [ ] Cuando haya un plan pago: agregarlo a la tabla `plans`, permitir cambiar el plan de un negocio desde Superadmin y cobrar la mensualidad — 🤖
- [ ] Confirmar en Superadmin → Facturación el precio del token, packs, tokens de bienvenida y vencimiento (el sitio los muestra tal cual) — 🧑
- [ ] Pasarela de pago para los tokens (Payment Latam: tarjeta, Yape, Plin, transferencia). Configurar credenciales en Superadmin — 🧑→🤖

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
- [ ] Responder cada reclamación en Superadmin → Complaints dentro de 15 días hábiles (llega aviso a `grupofazzilito@gmail.com`; requiere el correo del punto 2) — 🧑

## 7. Registro y configuración asistida

- [x] Todos los botones del sitio dicen "Regístrate gratis" (fuera "Agendar demo" y "Contactar ventas"); dentro de la app, modal y opción en el menú "?" con la configuración asistida de S/ 250 por Google Meet que abre WhatsApp — 🤖 (2026-10-14, rama `feat/signup-and-setup-help`)
- [ ] Poner tu número de WhatsApp en Superadmin → Settings → Soporte (sin él no aparecen el modal ni la opción del menú) — 🧑

## 8. Mantenimiento

- [ ] Revisar las 5 actualizaciones de dependabot pendientes — 🤖

---

## Orden sugerido

1.4 → 2.1 → 3.3 y 3.4 → 5 → 4.1
