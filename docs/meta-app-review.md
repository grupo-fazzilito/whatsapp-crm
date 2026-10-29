# Revisión de la app de Meta: guiones de video

Un video por canal y uno de comentarios. El mismo video se adjunta a cada permiso que cubre.

## Antes de grabar (una sola vez)

- [ ] Superadmin → Ajustes → Meta: App ID, Configuration ID de Embedded Signup y, si existe, el de Messenger/Instagram, todos llenos. El estado debe decir **Listo**.
- [ ] En la app de Meta → Webhooks:
  - [ ] **WhatsApp Business Account**: `messages`.
  - [ ] **Page**: `messages`, `messaging_postbacks`, `message_reactions`, `message_deliveries` y `feed`.
  - [ ] **Instagram**: `messages` y `comments`.
  - [ ] URL `https://whasalia.com/api/webhooks/meta` con el token de verificación del panel.
- [ ] Con la app en modo Desarrollo, cada cuenta de Facebook que inicie sesión debe tener un rol en la app (administrador o tester). Esto aplica también a la cuenta que manda mensajes desde fuera.
- [ ] Cuentas de prueba:
  - [ ] Una página de Facebook.
  - [ ] Una cuenta de Instagram **profesional** vinculada a esa página.
  - [ ] Un número de WhatsApp que **no** esté en la app de WhatsApp. Sirve el número de prueba de Meta.
  - [ ] Un segundo perfil de Facebook/Instagram y un celular para hacer de "cliente".
  - [ ] En Instagram, en el celular del cliente: Configuración → Mensajes → **Permitir acceso a los mensajes** activado en la cuenta del negocio. Sin esto, los DMs no llegan por API.
- [ ] Iniciar sesión en Whasalia con la cuenta de revisión `grupofazzilito+metareview@gmail.com` (negocio "Demo Store"). Es la misma cuenta que se entrega a Meta como credencial de prueba.
- [ ] Tener a mano la contraseña de la cuenta de revisión (la necesitas para el formulario).

## Reglas para todos los videos

- **Interfaz en inglés.** Cambiar ES → EN en el selector de idioma antes de empezar. Los revisores de Meta piden la app en inglés o con subtítulos.
- Grabar en 1080p, con el cursor visible y la barra de direcciones visible (`whasalia.com`). Sirven OBS o Loom.
- Sin audio obligatorio. Conviene agregar **subtítulos o textos en inglés** que digan qué se está haciendo ("Granting pages_messaging…").
- El flujo va completo y sin cortes en los pasos clave:
  1. Iniciar sesión en Whasalia.
  2. Mostrar la pantalla de permisos de Meta.
  3. Usar la función.
  4. Ver el resultado.
- Para mostrar el celular: espejo de pantalla (`scrcpy` en Android, QuickTime en iPhone) en una ventana al lado.
- No mostrar tokens ni contraseñas en pantalla.
- Duración: 2 a 4 minutos por video.

---

## Video 1: WhatsApp

**Permisos que cubre:** `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`.

1. Abrir `whasalia.com/login` e iniciar sesión.
2. Menú lateral → **Channels** → **Connect channel** → **WhatsApp**.
3. Elegir número nuevo (no coexistencia) → **Connect with Facebook (recommended)**.
4. En la ventana de Meta:
   1. Iniciar sesión.
   2. Elegir el portafolio de negocio (aquí se ve `business_management`).
   3. Elegir o crear la cuenta de WhatsApp Business.
   4. Elegir el número.
   5. Aceptar los permisos. *Mantener visible la pantalla donde Meta enumera los permisos.*
5. De vuelta en Whasalia: mensaje **"… connected!"** y el canal aparece como conectado.
6. **Management:** Settings → **Message templates** → **New template**:
   1. Llenar una plantilla de utilidad simple.
   2. **Submit for review**.
   3. **Sync with Meta**: se ve el estado "Pending" o "Approved" traído desde Meta.
7. **Messaging:**
   1. Desde el celular del cliente, mandar "Hola" al número.
   2. En Whasalia → **Inbox** aparece la conversación.
   3. Responder desde Whasalia.
   4. Mostrar en el celular que la respuesta llegó.
8. (Opcional) Enviar la plantilla aprobada desde la conversación.

**Texto para el formulario** (en inglés):
> Whasalia is a CRM where businesses connect their own WhatsApp Business number through Embedded Signup. We use whatsapp_business_management to read the business's WhatsApp account and phone numbers after signup, subscribe our app to its webhooks, and create and sync message templates. We use whatsapp_business_messaging to receive customer messages in the shared inbox and send replies and approved templates from our platform. We use business_management to list the business portfolios and WhatsApp accounts the user selects during signup.

---

## Video 2: Messenger

**Permisos que cubre:** `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `business_management`.

1. Iniciar sesión en Whasalia.
2. **Channels** → **Connect channel** → **Messenger** → **Continue with Facebook**.
3. En el diálogo de Meta:
   1. Elegir la página.
   2. Aceptar.
   3. *Mostrar la lista de permisos.*
4. En Whasalia aparece **Choose what to connect** con las páginas (aquí se ve `pages_show_list`). Marcar la página → **Connect selected**.
5. El canal Messenger aparece conectado. Al conectarlo, la app suscribe la página a los webhooks (`pages_manage_metadata`).
6. Desde el perfil del cliente, mandar un mensaje a la página por Messenger.
7. En Whasalia → **Inbox** aparece la conversación con el ícono de Messenger y el **nombre del cliente** (lo cubre la función *Business Asset User Profile Access*: adjuntar este video también a ella). Responder.
8. Mostrar la respuesta en Messenger del cliente.

**Texto para el formulario:**
> Businesses log in with Facebook to connect their Facebook Page to Whasalia. pages_show_list lets us show the Pages the user manages so they can choose which ones to connect. pages_manage_metadata subscribes the selected Page to our webhook so new messages reach the platform. pages_messaging lets the business read customer messages in our inbox and reply to them from Whasalia.

---

## Video 3: Instagram

**Permisos que cubre:** `instagram_basic`, `instagram_manage_messages`, `pages_show_list`, `business_management`.

1. Iniciar sesión en Whasalia.
2. **Channels** → **Connect channel** → **Instagram** → **Continue with Facebook**.
3. En Meta:
   1. Elegir la página y la cuenta de Instagram profesional vinculada.
   2. Aceptar.
   3. *Mostrar los permisos.*
4. En **Choose what to connect**:
   1. Se ve la cuenta de Instagram con su @usuario (`instagram_basic`).
   2. Marcarla → **Connect selected**.
5. Desde la cuenta de Instagram del cliente (celular), mandar un DM a la cuenta del negocio.
6. En Whasalia → **Inbox** aparece la conversación con el ícono de Instagram y el nombre o @usuario del cliente. Responder.
7. Mostrar la respuesta en el Instagram del cliente.

**Texto para el formulario:**
> Businesses connect their Instagram professional account (linked to their Facebook Page) to Whasalia. instagram_basic is used to show the account's username and profile so the user can confirm which account they are connecting. instagram_manage_messages lets the business receive Instagram Direct messages in our shared inbox and reply to customers from Whasalia.

---

## Video 4: Respuestas a comentarios

**Permisos que cubre:** `instagram_manage_comments`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`.

Hay que grabarlo **después** de conectar Instagram y Messenger con esos permisos ya aceptados. Si se conectaron antes, volver a conectar.

1. Iniciar sesión en Whasalia → **Automations** → **Comment replies**.
2. Crear una regla (**New comment rule**):
   1. En **Account**, elegir la cuenta de Instagram.
   2. **Only one post** → **Choose post** (se ve la lista de posts, `pages_read_engagement`).
   3. En **Keywords**, poner `price`.
   4. En **Public reply**, poner "We sent you a DM, {name}! 📩".
   5. En **Private message**, poner el precio.
   6. Guardar.
3. Desde la cuenta del cliente, comentar "price" en esa publicación.
4. Mostrar en el celular:
   1. La respuesta pública debajo del comentario.
   2. El DM recibido.
5. En Whasalia → **Inbox** aparece la conversación abierta por ese mensaje privado. Se ve también en **Latest replied comments**.
6. Repetir en 30 segundos con una publicación de la **página de Facebook** (canal Messenger). Así quedan cubiertos `pages_read_user_content` y `pages_manage_engagement`.

**Texto para el formulario:**
> Businesses create keyword rules for comments on their Instagram and Facebook posts. pages_read_engagement and pages_read_user_content let us list the Page's posts and read new comments delivered by the webhook. instagram_manage_comments and pages_manage_engagement let Whasalia post the business's public reply to the matching comment and send the commenter a private reply, which opens a conversation in our inbox.

---

## En el formulario de revisión

- **Credenciales de prueba** (en las notas para el revisor):
  - URL `https://whasalia.com/en/login`.
  - Email `grupofazzilito+metareview@gmail.com` y su contraseña.
  - Los pasos de cada video resumidos en 4 o 5 líneas.
- Adjuntar a cada permiso el video que lo cubre. `pages_show_list` y `business_management` pueden llevar el video 2.
- Al terminar la revisión: pasar la app a **Activo** y cambiar la contraseña de la cuenta de revisión (o borrarla). Ambos pendientes están en `docs/PENDIENTES.md` §3.
