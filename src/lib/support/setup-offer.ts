// Assisted setup: the platform team configures the account with the
// customer over Google Meet. Requested by WhatsApp; paid apart.

/** Price in soles. */
export const SETUP_HELP_PRICE = 250

/** wa.me link to the platform's support number with a prefilled message. */
export function setupHelpWhatsAppUrl(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}
