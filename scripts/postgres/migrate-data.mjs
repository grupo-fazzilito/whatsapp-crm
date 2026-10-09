// Copies everything from the Supabase database (and Storage) into the new
// plain-PostgreSQL database. The target must already have the schema
// (`npx prisma migrate deploy`) and no users yet.
//
//   SOURCE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//   TARGET_DATABASE_URL=postgresql://... \
//   SITE_URL=https://app.example.com \
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \   (to copy files; optional)
//   STORAGE_DRIVER=local|s3 [STORAGE_DIR | S3_*]                         (where files go)
//   node scripts/postgres/migrate-data.mjs [--dry-run] [--skip-files]
//
// What it does, in one target transaction with triggers off
// (session_replication_role = replica, so signup/webhook/realtime triggers
// don't fire while copying):
//   1. auth.users → users (+ credential account with the same bcrypt hash)
//   2. every public table, same rows and ids (columns matched by name)
//   3. identity sequences moved past the copied ids
//   4. Supabase Storage URLs in text/jsonb columns → <SITE_URL>/api/files/<bucket>/…
// Then (outside the transaction) copies the Storage objects.
import pg from 'pg'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const SKIP_FILES = args.has('--skip-files')
const env = (k, fallback) => {
  const v = process.env[k] ?? fallback
  if (v === undefined) throw new Error(`${k} is required`)
  return v
}
const SITE_URL = env('SITE_URL').replace(/\/+$/, '')
const SKIP_TABLES = new Set(['users', 'auth_sessions', 'auth_accounts', 'auth_verifications', '_prisma_migrations'])
const BATCH = 500

const source = new pg.Client({ connectionString: env('SOURCE_DATABASE_URL') })
const target = new pg.Client({ connectionString: env('TARGET_DATABASE_URL') })
const log = (...a) => console.log('[migrate]', ...a)
const q = (name) => `"${name.replaceAll('"', '""')}"`

async function tablesOf(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )
  return rows.map((r) => r.table_name)
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, is_generated, is_identity FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  )
  return rows
}

async function copyUsers() {
  const { rows } = await source.query(`
    SELECT id, lower(email) AS email, encrypted_password, raw_user_meta_data, email_confirmed_at,
           banned_until, last_sign_in_at, created_at, updated_at
    FROM auth.users WHERE deleted_at IS NULL AND email IS NOT NULL ORDER BY created_at`)
  for (const u of rows) {
    const meta = u.raw_user_meta_data ?? {}
    await target.query(
      `INSERT INTO public.users (id, email, name, email_verified, meta, banned, last_sign_in_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.email, String(meta.full_name ?? ''), !!u.email_confirmed_at, meta, !!u.banned_until && new Date(u.banned_until) > new Date(), u.last_sign_in_at, u.created_at, u.updated_at ?? u.created_at],
    )
    if (u.encrypted_password) {
      await target.query(
        `INSERT INTO public.auth_accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1::uuid, $1::text, 'credential', $2, now(), now())`,
        [u.id, u.encrypted_password],
      )
    }
  }
  return rows.length
}

async function copyTable(table) {
  const srcCols = new Set((await columnsOf(source, table)).map((c) => c.column_name))
  const tgtCols = await columnsOf(target, table)
  const cols = tgtCols.filter((c) => c.is_generated !== 'ALWAYS' && srcCols.has(c.column_name)).map((c) => c.column_name)
  if (!cols.length) return { table, copied: 0 }
  const identity = tgtCols.some((c) => c.is_identity === 'YES' && cols.includes(c.column_name))
  const list = cols.map(q).join(', ')
  let copied = 0
  // Keyset over ctid would be fragile; OFFSET is fine for a one-off copy of this size.
  for (let offset = 0; ; offset += BATCH) {
    const { rows } = await source.query(`SELECT ${list} FROM public.${q(table)} ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}`)
    if (!rows.length) break
    await target.query(
      `INSERT INTO public.${q(table)} (${list}) ${identity ? 'OVERRIDING SYSTEM VALUE' : ''}
       SELECT ${list} FROM json_populate_recordset(NULL::public.${q(table)}, $1::json)`,
      [JSON.stringify(rows)],
    )
    copied += rows.length
    if (rows.length < BATCH) break
  }
  return { table, copied }
}

async function resetSequences() {
  const { rows } = await target.query(`
    SELECT table_name, column_name, pg_get_serial_sequence('public.' || quote_ident(table_name), column_name) AS seq
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (is_identity = 'YES' OR column_default LIKE 'nextval%')`)
  for (const r of rows) {
    if (!r.seq) continue
    await target.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX(${q(r.column_name)}), 0) FROM public.${q(r.table_name)}), 1))`, [r.seq])
  }
}

/** Supabase Storage URLs → app URLs, in every text / text[] / jsonb column that contains one. */
async function rewriteStorageUrls() {
  const pattern = 'https?://[^"\\s,}]*?/storage/v1/object/(public|sign|authenticated)/(catalog|avatars|attachments)/([^"\\s?,}]*)(\\?[^"\\s,}]*)?'
  const replacement = `${SITE_URL}/api/files/\\2/\\3`
  const { rows } = await target.query(`
    SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (data_type IN ('text', 'character varying', 'jsonb') OR udt_name = '_text')`)
  let changed = 0
  for (const c of rows) {
    const col = q(c.column_name)
    const t = `public.${q(c.table_name)}`
    let sql
    if (c.data_type === 'jsonb') {
      sql = `UPDATE ${t} SET ${col} = regexp_replace(${col}::text, $1::text, $2::text, 'g')::jsonb WHERE ${col}::text ~ $1::text`
    } else if (c.udt_name === '_text') {
      sql = `UPDATE ${t} SET ${col} = (SELECT array_agg(regexp_replace(x, $1::text, $2::text, 'g') ORDER BY i) FROM unnest(${col}) WITH ORDINALITY AS u(x, i)) WHERE array_to_string(${col}, ' ') ~ $1::text`
    } else {
      sql = `UPDATE ${t} SET ${col} = regexp_replace(${col}, $1::text, $2::text, 'g') WHERE ${col} ~ $1::text`
    }
    const res = await target.query(sql, [pattern, replacement])
    if (res.rowCount) {
      changed += res.rowCount
      log(`  urls: ${c.table_name}.${c.column_name} → ${res.rowCount} rows`)
    }
  }
  return changed
}

async function copyFiles() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) {
    log('files: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipped')
    return 0
  }
  const { rows } = await source.query(`SELECT bucket_id, name, metadata->>'mimetype' AS mime FROM storage.objects ORDER BY created_at`)
  const driver = process.env.STORAGE_DRIVER === 's3' ? await s3Writer() : localWriter()
  let n = 0
  for (const o of rows) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${o.bucket_id}/${o.name.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    })
    if (!res.ok) {
      console.warn(`[migrate] files: ${o.bucket_id}/${o.name} → HTTP ${res.status}, skipped`)
      continue
    }
    const body = Buffer.from(await res.arrayBuffer())
    await driver(`${o.bucket_id}/${o.name}`, body, o.mime || res.headers.get('content-type') || 'application/octet-stream')
    n++
  }
  return n
}

function localWriter() {
  const root = path.resolve(process.env.STORAGE_DIR || '.storage')
  return async (key, body, contentType) => {
    const f = path.resolve(root, key)
    if (!f.startsWith(root + path.sep)) throw new Error(`bad key ${key}`)
    await mkdir(path.dirname(f), { recursive: true })
    await writeFile(f, body)
    await writeFile(`${f}.meta.json`, JSON.stringify({ contentType }))
  }
}

async function s3Writer() {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
  })
  const bucket = env('S3_BUCKET')
  return (key, body, contentType) => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
}

async function main() {
  await source.connect()
  await target.connect()
  const { rows: existing } = await target.query('SELECT count(*)::int AS n FROM public.users')
  if (existing[0].n > 0) throw new Error(`target already has ${existing[0].n} users — use an empty database`)

  const tables = (await tablesOf(target)).filter((t) => !SKIP_TABLES.has(t))
  const sourceTables = new Set(await tablesOf(source))
  await target.query('BEGIN')
  try {
    await target.query('SET LOCAL session_replication_role = replica')
    const users = await copyUsers()
    log(`users: ${users}`)
    const report = []
    for (const t of tables) {
      if (!sourceTables.has(t)) {
        log(`  ${t}: not in source, skipped`)
        continue
      }
      report.push(await copyTable(t))
    }
    await resetSequences()
    const urls = await rewriteStorageUrls()
    // Row counts must match the source.
    const mismatches = []
    for (const r of report) {
      const { rows } = await source.query(`SELECT count(*)::int AS n FROM public.${q(r.table)}`)
      if (rows[0].n !== r.copied) mismatches.push(`${r.table}: source ${rows[0].n}, copied ${r.copied}`)
    }
    log(`tables: ${report.length}, rows: ${report.reduce((a, r) => a + r.copied, 0)}, url rewrites: ${urls}`)
    for (const r of report.filter((r) => r.copied)) log(`  ${r.table}: ${r.copied}`)
    if (mismatches.length) throw new Error(`row count mismatch:\n${mismatches.join('\n')}`)
    if (DRY) {
      await target.query('ROLLBACK')
      log('dry run: rolled back')
    } else {
      await target.query('COMMIT')
      log('committed')
    }
  } catch (err) {
    await target.query('ROLLBACK').catch(() => {})
    throw err
  }
  if (!DRY && !SKIP_FILES) log(`files copied: ${await copyFiles()}`)
  await source.end()
  await target.end()
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message)
  process.exit(1)
})
