# Despliegue en Railway

Cómo está montada la app en Railway y cómo repetir la configuración desde cero.
La app solo necesita PostgreSQL, un lugar para guardar archivos y un cron; no
usa Supabase.

## Servicios del proyecto

| Servicio | Qué es | Configuración |
|---|---|---|
| `whatsapp-crm` | La app (Next.js) | Despliega la rama `main` de `grupo-fazzilito/whatsapp-crm` con Railpack (Node 20). Comando previo al despliegue: `npx prisma migrate deploy`. Volumen montado en `/data`. |
| `Postgres` | Base de datos (plantilla oficial de Postgres de Railway) | Sin acceso público. La app se conecta por la red privada. |
| `cron` | Imagen `alpine:3.20` con horario `*/5 * * * *` | Llama a los endpoints de tareas programadas (ver más abajo). |

Cada merge a `main` despliega solo: Railway construye la imagen, aplica las
migraciones pendientes de `prisma/migrations` y arranca `next start`. Si una
migración falla, el despliegue se detiene y la versión anterior sigue activa.

## Variables del servicio `whatsapp-crm`

### Obligatorias

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia al servicio de Postgres) |
| `BETTER_AUTH_SECRET` | Texto aleatorio largo: `openssl rand -base64 48`. Si se cambia, se cierran todas las sesiones. |
| `NEXT_PUBLIC_SITE_URL` | URL pública, por ejemplo `https://whatsapp-crm-production-a45a.up.railway.app`. Se usa al construir la app: si cambia, hay que volver a desplegar. |
| `BETTER_AUTH_URL` | La misma URL pública. |
| `ENCRYPTION_KEY` | 64 caracteres hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Debe ser la misma con la que se cifraron los datos copiados**; si se cambia, los tokens de canales y las claves de IA guardadas dejan de poder leerse. |
| `META_APP_SECRET` | App Secret de la app de Meta (firma de los webhooks). |
| `AUTOMATION_CRON_SECRET` | Texto aleatorio: `openssl rand -hex 32`. Lo comparte el servicio `cron`. |
| `STORAGE_DRIVER` | `local` (volumen) o `s3`. |
| `STORAGE_DIR` | `/data/storage` cuando `STORAGE_DRIVER=local`. |

### Opcionales

| Variable | Para qué |
|---|---|
| `META_APP_ID`, `META_LOGIN_CONFIG_ID` | Botón "Continuar con Facebook" para conectar Messenger e Instagram. |
| `META_VERIFY_TOKEN` | Token de verificación del webhook de Meta para toda la plataforma. |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `AI_PROVIDER_ORDER` | Claves de IA. Las del panel de superadmin tienen prioridad. |
| `MAILERSEND_API_KEY`, `MAIL_FROM` (opcional, por defecto `no-reply@whasalia.com`) | Correo por la API de MailerSend: códigos de acceso, invitaciones, tickets de soporte. Sin clave los correos no salen (`SMTP_*` queda como alternativa, pero Railway Hobby bloquea SMTP). |
| `SUPPORT_EMAIL` | Destino de los tickets nuevos (el panel de superadmin tiene prioridad). |
| `PLATFORM_ADMIN_EMAILS` | Correos que reciben el panel de superadmin al iniciar sesión. |
| `PAYMENT_LATAM_*` | Credenciales de Payment Latam (el panel de superadmin tiene prioridad). |
| `TIKTOK_MESSAGING_ENABLED` | `true` solo cuando TikTok apruebe el acceso. |
| `DATABASE_POOL_MAX` | Conexiones máximas a Postgres (por defecto 10). |

## Archivos

- **Volumen (configuración actual):** `STORAGE_DRIVER=local`, `STORAGE_DIR=/data/storage` y un volumen
  montado en `/data`. Es lo más simple, pero solo funciona con **una réplica**.
- **Railway Bucket u otro S3** (necesario para varias réplicas): `STORAGE_DRIVER=s3`, `S3_ENDPOINT`,
  `S3_REGION` (por defecto `auto`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  (`S3_FORCE_PATH_STYLE=true` para MinIO). Al cambiar de volumen a S3, copiar antes los archivos de
  `/data/storage` al bucket con la misma estructura de carpetas.

Los archivos privados se sirven por `/api/files/...` con enlaces firmados
(`STORAGE_SIGNING_SECRET`, que si no se define usa `ENCRYPTION_KEY`).

## Servicio `cron`

Variables:

```
CRON_SECRET=${{whatsapp-crm.AUTOMATION_CRON_SECRET}}
APP_URL=https://${{whatsapp-crm.RAILWAY_PUBLIC_DOMAIN}}
```

Comando de inicio (horario `*/5 * * * *`, política de reinicio "Never"):

```sh
sh -c 'for p in /api/automations/cron /api/flows/cron /api/business/bookings/reminders /api/business/follow-ups; do echo "$p"; wget -q -O- -T 120 --header "x-cron-secret: $CRON_SECRET" "$APP_URL$p" | head -c 300; echo; done'
```

| Endpoint | Qué hace |
|---|---|
| `/api/automations/cron` | Automatizaciones en espera, seguimientos, carritos abandonados, recordatorios de tareas, Google Calendar. |
| `/api/flows/cron` | Cierra los flujos que se quedaron esperando una respuesta. |
| `/api/business/bookings/reminders` | Recordatorios de reservas (24 h, 4 h, 2 h). |
| `/api/business/follow-ups` | Encuesta de satisfacción y seguimiento después de una reserva. |

Todos son idempotentes: si una ejecución se repite, nada se envía dos veces.

## Configuración fuera de Railway

- **Meta (WhatsApp, Messenger, Instagram):**
  - URL del webhook: `{NEXT_PUBLIC_SITE_URL}/api/webhooks/meta`.
  - URI de redirección OAuth: `{NEXT_PUBLIC_SITE_URL}/api/channels/meta/oauth/callback`.
- **Payment Latam:** nada que configurar. Cada pago lleva su propia URL de webhook firmada,
  construida con `NEXT_PUBLIC_SITE_URL`.
- **Dominio propio:**
  1. Agregarlo en Railway (Settings → Networking) y crear el CNAME que indica Railway.
  2. Cambiar `NEXT_PUBLIC_SITE_URL` y `BETTER_AUTH_URL`.
  3. Volver a desplegar.
  4. Actualizar las URLs de Meta.

## Montarlo desde cero

1. En un proyecto nuevo de Railway: **New → GitHub repo** (`grupo-fazzilito/whatsapp-crm`, rama `main`).
2. **New → Database → PostgreSQL.**
3. En el servicio de la app:
   - agregar un volumen montado en `/data`;
   - cargar las variables obligatorias;
   - en Settings → Deploy, poner `npx prisma migrate deploy` como comando previo al despliegue.
4. Settings → Networking → **Generate Domain**. Poner esa URL en `NEXT_PUBLIC_SITE_URL` y
   `BETTER_AUTH_URL`, y volver a desplegar.
5. Datos, una de dos:
   - **Base nueva:** las migraciones crean el esquema al desplegar. Para crear el superadmin, activar
     temporalmente el acceso público de Postgres (Settings → Networking → TCP Proxy) y correr:
     ```bash
     DATABASE_URL=<url pública> npm run create-superadmin -- <email> <contraseña>
     ```
   - **Copiar una base existente:** con el acceso público activado, restaurar un volcado sobre la base vacía:
     ```bash
     pg_dump --no-owner --no-privileges -d <base origen> > dump.sql
     psql "<url pública>" -v ON_ERROR_STOP=1 -q < dump.sql
     ```
     El volcado incluye `_prisma_migrations`, así que `migrate deploy` solo aplica lo que falte.
     Usar la misma `ENCRYPTION_KEY` que la base de origen.
   - **Desde Supabase:** usar `scripts/postgres/migrate-data.mjs` (ver `docs/postgres-migration.md`).
6. Al terminar, desactivar el acceso público de Postgres.
7. Crear el servicio `cron`: **New → Docker Image** `alpine:3.20`, con las variables, el comando y el
   horario de arriba.
8. Probar:
   - iniciar sesión con el superadmin en `/login`;
   - abrir `/admin-panel`;
   - revisar en los logs del servicio `cron` que los cuatro endpoints responden sin error.

## Problemas comunes

| Síntoma | Causa |
|---|---|
| `Can't reach database server` al desplegar | `DATABASE_URL` no apunta al servicio de Postgres, o Postgres sigue arrancando. |
| Se cierran todas las sesiones | Cambió `BETTER_AUTH_SECRET`. |
| Canales desconectados o la IA sin clave después de copiar datos | `ENCRYPTION_KEY` distinta a la de origen. |
| El cron devuelve `cron not configured` (503) o `401` | Falta `AUTOMATION_CRON_SECRET` en la app, o no coincide con `CRON_SECRET`. |
| Los archivos subidos desaparecen tras desplegar | Falta el volumen en `/data`, o `STORAGE_DIR` apunta fuera de él. |
| Enlaces o redirecciones al dominio viejo | Cambió el dominio y no se actualizó `NEXT_PUBLIC_SITE_URL` o no se volvió a desplegar. |
