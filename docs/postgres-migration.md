# Migración de Supabase a PostgreSQL + Prisma (Railway)

Rama: `feat/postgres` (sale de `feat/meta-usage`). Objetivo: que la app corra
contra **un PostgreSQL normal** (Railway Postgres) sin ningún servicio de
Supabase, validado en local antes de desplegar.

## Decisiones

| Tema | Hoy (Supabase) | Después |
|---|---|---|
| Consultas | `supabase-js` (PostgREST), 899 consultas | **Prisma 7** (`@prisma/adapter-pg`) en el servidor |
| Consultas desde el navegador | 77 componentes con `createClient()` | Rutas de API / Server Actions |
| Aislamiento entre negocios | RLS (127 políticas, `auth.uid()`) | **Guardia obligatoria en el servidor**: cliente Prisma por workspace que inyecta `workspace_id` en cada consulta de tablas de negocio + pruebas de aislamiento |
| Login | Supabase Auth (OTP, contraseña, sesiones) | **Better Auth** (adaptador Prisma, email+contraseña, OTP por correo); contraseñas bcrypt migradas tal cual |
| Archivos | Supabase Storage (`attachments`, `avatars`) | **S3 compatible** (Railway Buckets / R2 / MinIO en local) con URLs firmadas |
| Tiempo real | Supabase Realtime (`postgres_changes`) | **SSE** (`/api/events`) + `LISTEN/NOTIFY` de Postgres |
| Funciones y triggers SQL (80/79) | En migraciones | Se mantienen en SQL (Postgres), llamados con `$queryRaw` |
| Motor | Postgres | Postgres (cualquier proveedor). Otro motor exigiría rediseñar jsonb, arrays, búsqueda full-text y funciones |

## Fases (cada una deja la app funcionando y verificada)

- [x] **P0 Base**: Postgres local sin Supabase (`docker-compose.postgres.yml`), Prisma configurado, `schema.prisma` introspectado, cliente con guardia de workspace, scripts.
- [x] **P1 Servidor → Prisma**: `src/lib/**` y `src/app/api/**` dejan `supabaseAdmin()`/`createClient()` por Prisma, módulo por módulo. Mientras tanto Prisma apunta a la BD local de Supabase (mismo esquema `public`), así la app sigue funcionando con el login actual; no usar la relación `users` hasta P3.
- [ ] **P2 Navegador → API**: los 77 componentes que consultan directo pasan a rutas de API / Server Actions.
- [ ] **P3 Login**: Better Auth; tabla `users` propia reemplaza `auth.users` (FKs, triggers de alta de workspace, superadmin, invitaciones, OTP); script de migración de usuarios.
- [ ] **P4 Archivos**: driver S3 (y disco local para desarrollo); script que copia los archivos existentes.
- [ ] **P5 Tiempo real**: SSE + `LISTEN/NOTIFY` para bandeja, notificaciones, pedidos, tareas.
- [ ] **P6 Datos y limpieza**: (esquema base ya hecho en P0) script de copia de datos Supabase → Postgres (usuarios, negocios, mensajes, archivos); quitar `@supabase/*`.
- [ ] **P7 Validación completa** en Postgres puro: tsc, vitest, pruebas de aislamiento, build, e2e (IA real, pedidos, inmobiliaria, créditos, Meta, webhooks, API pública).
- [ ] **P8 Railway**: guía y variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, S3, cron).

## Cómo correrlo en local (Postgres puro)

```bash
npm run db:up                      # Postgres 17 en localhost:5434 (crm/crm)
DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npm run db:migrate
npm run db:generate                # cliente en src/generated/prisma
TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/db
```

- Esquema base: `prisma/migrations/0_baseline/migration.sql`, generado con
  `scripts/postgres/build-baseline.mjs` desde el esquema de Supabase (sin RLS,
  `auth.users` → `public.users`, `auth.uid()` → `public.app_user_id()`).
- Acceso a datos: `tenantDb(workspaceId)` (`src/lib/db/tenant.ts`) para todo lo
  del negocio; `prisma` (`src/lib/db/prisma.ts`) solo para tareas de plataforma.
- Modelos con el mismo nombre que las tablas (`prisma.ai_agents`, `tenantDb(ws).messages`).
- Las filas vuelven igual que con Supabase: fechas en texto ISO, `DATE` como `YYYY-MM-DD`,
  `NUMERIC`/`BIGINT` como número (`src/lib/db/result-compat.ts`, generado con
  `node scripts/postgres/gen-schema-meta.mjs` tras cada cambio de esquema). Para `$queryRaw`
  usar `normalizeRaw()`.
- Al crear filas con `tenantDb`, pasar siempre `workspace_id` (la guardia verifica que sea el del negocio).

## Después de la migración (pedido del usuario, 2026-10-09)

- Agentes de IA creados desde un menú; cada agente con un **contexto de entrenamiento** de hasta 5.000 caracteres.
- **Chat de prueba** que muestra las respuestas con el aspecto de cada canal (WhatsApp, Instagram, Messenger, web).
- Las pruebas del chat **gastan créditos** (gratis o pagados) igual que una respuesta real.

## Reglas durante la migración

- No tocar `tom@tom.com`, `admin@victoria.com` ni el workspace "Fazzil" (solo copiarlos).
- Cada fase termina con commit en `feat/postgres`; nada se sube a `main` hasta P7.
- Toda consulta de una tabla de negocio pasa por el cliente con guardia de workspace; el cliente sin guardia (`prisma`) solo para crons, webhooks y tareas de plataforma.

## Guía de conversión (P1)

Cliente según el caso:

| Antes | Después |
|---|---|
| `guard.ctx.supabase` (ruta con sesión) | `guard.ctx.db` (= `tenantDb(workspace.id)`) |
| `supabaseAdmin()` con `.eq('workspace_id', ws)` | `tenantDb(ws)` (el filtro lo pone la guardia; se puede quitar) |
| `supabaseAdmin()` en tareas de plataforma (cron que recorre todos los negocios, webhooks de Meta/Payment Latam antes de saber el negocio, panel de superadmin, `platform_settings`, `profiles`) | `prisma` de `@/lib/db/prisma` |
| `@/lib/automations/admin-client` | igual que `supabaseAdmin()` |

Equivalencias:

```ts
// select con filtros, orden y límite
db.from('contacts').select('id, name').eq('status', 'active').in('id', ids).order('created_at', { ascending: false }).limit(20)
→ db.contacts.findMany({ select: { id: true, name: true }, where: { status: 'active', id: { in: ids } }, orderBy: { created_at: 'desc' }, take: 20 })

.maybeSingle()            → findFirst(...)        (devuelve null)
.single()                 → findFirstOrThrow(...) o findUniqueOrThrow
.range(a, b)              → skip: a, take: b - a + 1
.ilike('name', `%${q}%`)  → { name: { contains: q, mode: 'insensitive' } }
.or('a.eq.1,b.is.null')   → { OR: [{ a: 1 }, { b: null }] }
.gte/.lte/.gt/.lt/.neq    → { gte } / { lte } / { gt } / { lt } / { not: x }
.is('x', null)            → { x: null }
.contains('tags', ['a'])  → { tags: { hasEvery: ['a'] } }   (jsonb: { path: [...], equals } o $queryRaw)
select('*, contact:contacts(name)') → include: { contacts: { select: { name: true } } }  y renombrar al leer (row.contacts → contact)
select('id', { count: 'exact', head: true }) → db.x.count({ where })
.insert(row).select().single()   → db.x.create({ data: { ...row, workspace_id: ws } })
.insert(rows)                     → db.x.createMany({ data: rows.map(r => ({ ...r, workspace_id: ws })) })
.update(p).eq('id', id)           → db.x.updateMany({ where: { id }, data: p })   (update() si debe existir: lanza P2025)
.upsert(row, { onConflict: 'a,b' }) → db.x.upsert({ where: { a_b: { a, b } }, create, update })  (nombre de la clave única en schema.prisma)
.delete().eq('id', id)            → db.x.deleteMany({ where: { id } })
.rpc('fn', { a, b })              → normalizeRaw(await prisma.$queryRaw`SELECT * FROM public.fn(${a}::uuid, ${b})`)
```

Reglas:

- `{ data, error }` desaparece: Prisma **lanza**. Donde el código tragaba el error, envolver en `try/catch` con el mismo comportamiento; donde respondía 500, dejar que lo maneje el `catch` de la ruta.
- Errores conocidos: único `P2002` (antes `23505`), no encontrado `P2025`, FK `P2003` (antes `23503`). Usar `isPrismaError(err, 'P2002')` de `@/lib/db/errors`.
- Los nombres de relación en `include` son los de `schema.prisma` (normalmente el nombre de la tabla). Si la respuesta de la API usaba alias (`contact:contacts(...)`), mapear para que la forma JSON **no cambie**.
- Las filas mantienen la forma de PostgREST (fechas en texto, montos en número). No convertir a mano.
- No cambiar comportamiento ni respuestas de API: es una migración, no un refactor.
- Tests: los que usan `FakeDb` (`@/lib/test-utils/fake-supabase`) pasan a pruebas contra Postgres real con `@/lib/test-utils/pg` (se saltan sin `TEST_DATABASE_URL`).
- No tocar todavía: login (`auth.*`), Storage, Realtime, `createClient` del navegador (son P2–P5).

## Guía de conversión (P2/P4/P5: navegador, archivos, tiempo real)

**Consultas del navegador.** Un componente `'use client'` no puede usar Prisma. Cada
`createClient().from(...)` del navegador pasa a `fetch` contra una ruta de API:
reutilizar la ruta existente si ya devuelve lo necesario; si no, crear una nueva en
`src/app/api/<área>/...` con `requireWorkspace(rol)` + `ctx.db`, respetando los roles
que imponía RLS (lecturas `agent`, configuración `admin`). Mantener la forma de los datos
que el componente espera.

**Tiempo real** (`src/lib/realtime/client.ts`):

```ts
const { workspace } = useWorkspace()
useRealtimeChanges<Message>({
  workspaceId: workspace?.id,
  tables: ['messages'],
  onChange: (c) => { /* c.eventType 'INSERT'|'UPDATE'|'DELETE', c.new (fila completa), c.old (claves en DELETE) */ },
})
const connected = useRealtimeConnected()
```

Las tablas disponibles están en `src/lib/realtime/types.ts` (agregar una tabla requiere
el trigger `realtime_notify` en una migración). Los filtros que antes iban en
`postgres_changes` (`conversation_id=eq.X`) se aplican en `onChange`. Las notificaciones
solo llegan a su destinatario.

**Archivos** (`src/lib/storage`): buckets `attachments` (privado), `catalog` y `avatars` (públicos).

| Antes (Supabase) | Después |
|---|---|
| navegador `storage.from(b).upload(path, file)` | `uploadFile(b, file, { path })` de `@/lib/storage/client` → `{ path, url }` |
| navegador `createSignedUrl(path, ttl)` | `signFile(b, path, { expiresIn })` / `signFiles(b, paths)` |
| navegador `getPublicUrl(path)` | la `url` que devuelve `uploadFile`, o `/api/files/<b>/<path>` |
| servidor `storage.from(b).upload/download/remove` | `uploadObject` / `downloadObject` / `removeObjects` de `@/lib/storage` |
| servidor `getPublicUrl` / `createSignedUrl(s)` | `publicUrl(b, path)` / `signedUrl(b, path, ttl)` |
| marcadores `/storage/v1/object/...` para sacar la ruta de una URL | `storagePathFromUrl(url, b)` de `@/lib/storage/paths` (entiende URLs viejas y nuevas) |

Rutas: los archivos de `attachments` y `catalog` van bajo `<workspace_id>/…`; los avatares bajo `<user_id>/…`.
Variables: `STORAGE_DRIVER=local|s3`, `STORAGE_DIR`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `STORAGE_SIGNING_SECRET` (opcional, por defecto `ENCRYPTION_KEY`).
