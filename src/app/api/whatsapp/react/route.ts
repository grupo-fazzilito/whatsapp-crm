import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/workspace/context';
import { sendReaction } from '@/lib/messaging/send';
import { isPrismaError } from '@/lib/db/errors';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Sends the reaction through the conversation's channel and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions are handled by the
 * webhook — this route only writes `actor_type = 'agent'` rows.
 */
export async function POST(request: Request) {
  try {
    const guard = await requireWorkspace();
    if (!guard.ok) return guard.response;
    const { db, user, workspace } = guard.ctx;

    const limit = checkRateLimit(`react:${user.id}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    // Resolve target message + its conversation; verify ownership.
    // A malformed id fails the query: same 404 as a missing row.
    const targetMessage = await db.messages
      .findFirst({
        select: { id: true, message_id: true, conversation_id: true },
        where: { id: message_id },
      })
      .catch(() => null);

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      // No Meta ID yet — usually a sending/failed agent message. We can't
      // tell Meta to react to a message it never received.
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const conversation = await db.conversations
      .findFirst({
        select: { id: true },
        where: { id: targetMessage.conversation_id, workspace_id: workspace.id },
      })
      .catch(() => null);

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    // Sent through the conversation's channel (no-op on channels without
    // reactions); provider errors bubble up as 502.
    try {
      await sendReaction({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: targetMessage.id,
        emoji,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown provider error';
      console.error('[whatsapp/react] send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    // Mirror into DB. Empty emoji = removal.
    if (emoji === '') {
      const delError = await db.message_reactions
        .deleteMany({
          where: { message_id: targetMessage.id, actor_type: 'agent', actor_id: user.id },
        })
        .then(() => null, (err: unknown) => err);

      if (delError) {
        console.error('[whatsapp/react] DB delete failed:', delError instanceof Error ? delError.message : delError);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB delete failed' },
          { status: 500 },
        );
      }
    } else {
      // Upsert. The unique constraint (message_id, actor_type, actor_id)
      // lets us swap emoji in a single statement.
      const key = { message_id: targetMessage.id, actor_type: 'agent', actor_id: user.id };
      const upsert = () =>
        db.message_reactions.upsert({
          where: { message_id_actor_type_actor_id: key },
          create: {
            workspace_id: workspace.id,
            ...key,
            conversation_id: targetMessage.conversation_id,
            emoji,
          },
          update: { conversation_id: targetMessage.conversation_id, emoji },
        });
      const upsertError = await upsert()
        // Lost a race with a concurrent insert: the row exists now, update it.
        .catch((err: unknown) => (isPrismaError(err, 'P2002') ? upsert() : Promise.reject(err)))
        .then(() => null, (err: unknown) => err);

      if (upsertError) {
        console.error('[whatsapp/react] DB upsert failed:', upsertError instanceof Error ? upsertError.message : upsertError);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB upsert failed' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 },
    );
  }
}
