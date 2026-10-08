/**
 * Window event the notification bell dispatches when the user opens a
 * conversation notification while already on /inbox (the page then
 * selects it without a reload). detail: { conversationId }.
 */
export const OPEN_CONVERSATION_EVENT = "inbox:open-conversation";
