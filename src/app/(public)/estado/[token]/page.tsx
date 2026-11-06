import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { postByShareToken } from '@/lib/social/server'
import { createTranslator } from '@/i18n/translate'
import { captionFor } from '@/lib/social/model'
import { StatusShare } from './status-share'

// Public page linked from the WhatsApp message "ready for your status":
// the post's photos/videos and caption, with "Share on WhatsApp" (the
// phone's share sheet, where WhatsApp offers "My status") and downloads.
// Reached only with the post's random token.

export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'WhatsApp' }

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await postByShareToken(token)
  if (!found) notFound()
  const t = createTranslator(found.locale)
  const { post } = found
  return (
    <main lang={found.locale} className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 [color-scheme:light]">
      <div className="mx-auto max-w-md space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-bold">{t('posts.statusPage.title')}</h1>
          <p className="text-sm text-slate-600">{t('posts.statusPage.intro', { business: found.business })}</p>
        </header>
        <StatusShare
          media={post.media}
          caption={captionFor('whatsapp_status', post.caption, post.link_url)}
          texts={{
            share: t('posts.statusPage.share'),
            download: t('posts.statusPage.download'),
            copy: t('posts.statusPage.copy'),
            copied: t('posts.statusPage.copied'),
            steps: t('posts.statusPage.steps'),
          }}
        />
      </div>
    </main>
  )
}
