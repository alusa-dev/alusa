export const META_PIXEL_MAP_SLUGS = new Set([
  'map_58c37147e01c496f92bc6f5f',
  'map_dc0c9a1a841941138d558b3d',
]);

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
