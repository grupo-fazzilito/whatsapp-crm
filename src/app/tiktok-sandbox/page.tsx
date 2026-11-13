import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, FlaskConical } from 'lucide-react'
import { getT } from '@/i18n/server'
import { tiktokSandbox } from '@/lib/tiktok/config'
import { SANDBOX_ACCOUNT, SANDBOX_CODE } from '@/lib/tiktok/sandbox'

// Local demo only (TIKTOK_SANDBOX): stands in for TikTok's authorization
// screen, which can't be shown until TikTok approves the app. 404 elsewhere.

export const dynamic = 'force-dynamic'

const SCOPES = ['user', 'media', 'comments'] as const

export default async function TiktokSandboxAuthorize({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (!tiktokSandbox()) notFound()
  const { state } = await searchParams
  if (!state) notFound()
  const t = await getT()
  const authorize = `/api/channels/tiktok/oauth/callback?${new URLSearchParams({ auth_code: SANDBOX_CODE, state })}`

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <FlaskConical className="size-3.5" aria-hidden />
          {t('channels.tiktok.sandbox.banner')}
        </p>
        <section className="rounded-2xl bg-white p-6 text-neutral-900 shadow-xl" aria-labelledby="tt-auth-title">
          <h1 id="tt-auth-title" className="text-lg font-semibold">
            {t('channels.tiktok.sandbox.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {t('channels.tiktok.sandbox.account')} <b>@{SANDBOX_ACCOUNT.username}</b>
          </p>
          <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
            {SCOPES.map((s) => (
              <li key={s} className="flex gap-3 py-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-neutral-900 text-white">
                  <Check className="size-3.5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium">{t(`channels.tiktok.sandbox.scope.${s}`)}</span>
                  <span className="block text-xs text-neutral-500">{t(`channels.tiktok.sandbox.scope.${s}Help`)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <Link href="/channels?connect=tiktok&error=denied" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100">
              {t('common.cancel')}
            </Link>
            <a href={authorize} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              {t('channels.tiktok.sandbox.authorize')}
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
