export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'shipped' | 'delivered' | 'cancelled';
export type Fulfillment = 'pickup' | 'delivery' | 'dine_in';
export type PaymentStatus = 'unpaid' | 'awaiting_proof' | 'proof_received' | 'paid' | 'refunded';
export type PaymentMethodType = 'qr' | 'bank_transfer' | 'cash' | 'card_on_delivery' | 'other';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'];
/** Kanban columns (cancelled orders only show in the list). */
export const BOARD_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered'];
export const FULFILLMENTS: Fulfillment[] = ['pickup', 'delivery', 'dine_in'];
export const PAYMENT_METHOD_TYPES: PaymentMethodType[] = ['qr', 'bank_transfer', 'cash', 'card_on_delivery', 'other'];

/** Payment filter on the orders page. */
export type PaymentFilter = 'all' | 'to_verify' | 'pending' | 'paid';
export const PAYMENT_FILTERS: PaymentFilter[] = ['all', 'to_verify', 'pending', 'paid'];
export const PAYMENT_FILTER_STATUSES: Record<Exclude<PaymentFilter, 'all'>, PaymentStatus[]> = {
  to_verify: ['proof_received'],
  pending: ['unpaid', 'awaiting_proof'],
  paid: ['paid'],
};

export interface OrderRow {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  customer_name: string | null;
  customer_phone: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  channel_id: string | null;
  address: string | null;
  address_reference: string | null;
  notes: string | null;
  currency: string;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  payment_status: PaymentStatus;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_proof_url: string | null;
  paid_at: string | null;
  source: 'ai' | 'chat_buttons' | 'manual' | 'webchat';
  created_at: string;
  updated_at: string;
  contact?: { name: string | null; phone: string | null } | null;
  channel?: { type: string; name: string | null } | null;
  order_items?: { count: number }[];
}

export interface OrderItem {
  id: string;
  name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  notes: string | null;
  sort_order: number;
}

export interface OrderEvent {
  id: string;
  type: 'created' | 'status' | 'payment' | 'note' | 'notified' | string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  user_id: string | null;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  instructions: string | null;
  qr_image_url: string | null;
  requires_proof: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface NextAction {
  status: OrderStatus;
  /** i18n key under orders.actions */
  key: string;
}

/** Forward step(s) available from `status` (cancel is offered separately). */
export function nextActions(status: OrderStatus, fulfillment: Fulfillment): NextAction[] {
  switch (status) {
    case 'pending':
      return [{ status: 'confirmed', key: 'confirm' }];
    case 'confirmed':
      return [{ status: 'preparing', key: 'preparing' }];
    case 'preparing':
      return [{ status: 'ready', key: 'ready' }];
    case 'ready':
      return fulfillment === 'delivery'
        ? [{ status: 'shipped', key: 'shipped' }, { status: 'delivered', key: 'delivered' }]
        : [{ status: 'delivered', key: 'delivered' }];
    case 'shipped':
      return [{ status: 'delivered', key: 'delivered' }];
    default:
      return [];
  }
}

export const isClosed = (s: OrderStatus) => s === 'cancelled' || s === 'delivered';

/** Tailwind classes for the status chip. */
export const STATUS_TONE: Record<OrderStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  confirmed: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  preparing: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  ready: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  shipped: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  delivered: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  cancelled: 'bg-muted text-muted-foreground',
};

export const PAYMENT_TONE: Record<PaymentStatus, string> = {
  unpaid: 'bg-muted text-muted-foreground',
  awaiting_proof: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  proof_received: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  refunded: 'bg-muted text-muted-foreground',
};

/** Translates an API error code (incl. "out_of_stock:<name>") into a message. */
export function orderErrorMessage(t: (k: string, v?: Record<string, string | number>) => string, code: string | undefined): string {
  if (!code) return t('orders.errors.generic');
  if (code.startsWith('out_of_stock:')) return t('orders.errors.outOfStock', { name: code.slice('out_of_stock:'.length) });
  const known = ['not_found', 'closed', 'not_pending', 'not_cancellable', 'invalid_status', 'Forbidden', 'Unauthorized'];
  return known.includes(code) ? t(`orders.errors.${code}`) : code;
}
