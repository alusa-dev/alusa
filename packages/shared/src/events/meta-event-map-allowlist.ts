export const META_PIXEL_MAP_SLUGS: ReadonlySet<string> = new Set([
  'map_58c37147e01c496f92bc6f5f',
  'map_dc0c9a1a841941138d558b3d',
]);

export function isMetaPixelMapSlug(publicSlug: string): boolean {
  return META_PIXEL_MAP_SLUGS.has(publicSlug);
}

export function metaPixelPurchaseEventId(orderId: string): string {
  return `alusa_purchase_${orderId}`;
}
