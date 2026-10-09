import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Local secrets live in .env.local (Next's convention); fall back to .env.
config({ path: '.env.local' })
config()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Empty when generating the client without a database (CI, postinstall).
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
