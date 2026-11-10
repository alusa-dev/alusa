import { META_PIXEL_MAP_SLUGS } from '@alusa/shared';

export { META_PIXEL_MAP_SLUGS } from '@alusa/shared';

export function hasCurrentMarketingConsent(value: unknown, policyVersion: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const consent = value as { policyVersion?: unknown; categories?: { marketing?: unknown } };
  return consent.policyVersion === policyVersion && consent.categories?.marketing === true;
}

export function shouldSendMetaPixelPurchase(input: {
  publicSlug: string;
  mode: 'public' | 'preview';
  orderStatus?: string | null;
  paymentStatus?: string | null;
}) {
  return input.mode === 'public'
    && META_PIXEL_MAP_SLUGS.has(input.publicSlug)
    && input.orderStatus === 'CONFIRMED'
    && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'PAID'].includes(input.paymentStatus?.toUpperCase() ?? '');
}

export function metaPixelPurchaseDedupeKey(orderId: string) {
  return `alusa.meta-pixel.purchase.${orderId}`;
}

export function metaPixelPurchaseEventId(orderId: string) {
  return `alusa_purchase_${orderId}`;
}

export function metaPixelPurchaseEventId(orderId: string) {
  return `alusa_purchase_${orderId}`;
}
