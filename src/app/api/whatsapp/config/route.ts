import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { defaultChannel, saveChannelSecrets } from '@/lib/channels/store'

/**
 * LEGACY shim over `channels` for the old single-number WhatsApp settings
 * form. It operates on the workspace's default WhatsApp channel; new UI
 * should use /api/channels.
 */

/**
 * GET /api/whatsapp/config
 *
 * Health of the default WhatsApp channel. Returns 200 in all non-auth
 * cases so the UI can render an appropriate message rather than a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...}, channel_id, phone_number_id, waba_id }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
    const guard = await requireWorkspace()
    if (!guard.ok) return guard.response
    const { workspace } = guard.ctx

    const channel = await defaultChannel(workspace.id, 'whatsapp')
    if (!channel || (channel.status === 'disconnected' && !channel.secrets.access_token)) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    const ids = {
      channel_id: channel.id,
      phone_number_id: channel.external_id,
      waba_id: typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : null,
    }

    const accessToken = channel.secrets.access_token
    if (!accessToken) {
      // loadChannel drops secrets it can't decrypt: if one is stored, the
      // ENCRYPTION_KEY changed (or differs between environments).
      const { data: raw } = await supabaseAdmin()
        .from('channel_secrets')
        .select('secrets')
        .eq('channel_id', channel.id)
        .maybeSingle()
      const stored = !!(raw?.secrets as Record<string, string> | null)?.access_token
      return NextResponse.json(
        stored
          ? {
              ...ids,
              connected: false,
              reason: 'token_corrupted',
              needs_reset: true,
              message:
                'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments. Click "Reset Configuration" below, then re-save.',
            }
          : {
              ...ids,
              connected: false,
              reason: 'no_config',
              message: 'No access token saved for this WhatsApp number. Re-enter it and click Save Configuration.',
            },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: channel.external_id,
        accessToken,
      })
      return NextResponse.json({ ...ids, connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          ...ids,
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config  (admin)
 *
 * Body: { phone_number_id, access_token, waba_id?, verify_token? }
 * Verifies the credentials with Meta, then creates/updates the default
 * WhatsApp channel (secrets encrypted in channel_secrets).
 * → { success, phone_info, channel_id }
 */
export async function POST(request: Request) {
  try {
    const guard = await requireWorkspace('admin')
    if (!guard.ok) return guard.response
    const { workspace } = guard.ctx

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()

    // A phone number id belongs to exactly one channel across the platform.
    const { data: owner } = await db
      .from('channels')
      .select('id, workspace_id')
      .eq('type', 'whatsapp')
      .eq('external_id', phone_number_id)
      .maybeSingle()
    if (owner && owner.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'This WhatsApp number is already connected to another workspace.' },
        { status: 409 }
      )
    }

    const existing = owner ? null : await defaultChannel(workspace.id, 'whatsapp')
    const targetId = owner?.id ?? existing?.id ?? null
    let previousSettings: Record<string, unknown> = existing?.settings ?? {}
    if (owner) {
      const { data } = await db.from('channels').select('settings').eq('id', owner.id).maybeSingle()
      previousSettings = (data?.settings as Record<string, unknown>) ?? {}
    }

    const now = new Date().toISOString()
    const fields = {
      external_id: phone_number_id,
      display_handle: phoneInfo.display_phone_number ?? null,
      status: 'connected' as const,
      status_detail: null,
      settings: {
        ...previousSettings,
        waba_id: waba_id || null,
        verified_name: phoneInfo.verified_name ?? null,
        quality_rating: phoneInfo.quality_rating ?? null,
      },
      updated_at: now,
    }

    let channelId: string
    if (targetId) {
      const { error: updateError } = await db
        .from('channels')
        .update(fields)
        .eq('id', targetId)
        .eq('workspace_id', workspace.id)
      if (updateError) {
        console.error('Error updating WhatsApp channel:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
      channelId = targetId
    } else {
      const { data: created, error: insertError } = await db
        .from('channels')
        .insert({
          ...fields,
          workspace_id: workspace.id,
          type: 'whatsapp',
          name: phoneInfo.verified_name || phoneInfo.display_phone_number || 'WhatsApp',
        })
        .select('id')
        .single()
      if (insertError || !created) {
        console.error('Error creating WhatsApp channel:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
      channelId = created.id
    }

    try {
      await saveChannelSecrets(channelId, {
        access_token,
        // Blank keeps the stored verify token.
        verify_token: verify_token || undefined,
      })
    } catch (err) {
      console.error('Saving channel secrets failed:', err instanceof Error ? err.message : err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, phone_info: phoneInfo, channel_id: channelId })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config  (admin)
 *
 * Disconnects the default WhatsApp channel: marks it disconnected and
 * drops its access token (the row stays so conversations keep their
 * channel). Used by "Reset Configuration" to recover from a token that
 * can't be decrypted.
 */
export async function DELETE() {
  try {
    const guard = await requireWorkspace('admin')
    if (!guard.ok) return guard.response
    const { workspace } = guard.ctx

    const channel = await defaultChannel(workspace.id, 'whatsapp')
    if (!channel) return NextResponse.json({ success: true })

    const { error: updateError } = await supabaseAdmin()
      .from('channels')
      .update({
        status: 'disconnected',
        status_detail: 'Disconnected from settings',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.id)
      .eq('workspace_id', workspace.id)

    if (updateError) {
      console.error('Error disconnecting WhatsApp channel:', updateError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    await saveChannelSecrets(channel.id, { access_token: null })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
