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
- [ ] **P1 Servidor → Prisma**: `src/lib/**` y `src/app/api/**` dejan `supabaseAdmin()`/`createClient()` por Prisma, módulo por módulo. Mientras tanto Prisma apunta a la BD local de Supabase (mismo esquema `public`), así la app sigue funcionando con el login actual; no usar la relación `users` hasta P3.
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

## Reglas durante la migración

- No tocar `tom@tom.com`, `admin@victoria.com` ni el workspace "Fazzil" (solo copiarlos).
- Cada fase termina con commit en `feat/postgres`; nada se sube a `main` hasta P7.
- Toda consulta de una tabla de negocio pasa por el cliente con guardia de workspace; el cliente sin guardia (`prisma`) solo para crons, webhooks y tareas de plataforma.
