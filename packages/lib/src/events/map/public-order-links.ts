export function publicOrderTicketsPath(orderId: string, accessToken: string) {
  return `/api/public/event-map-orders/${orderId}/tickets?token=${encodeURIComponent(accessToken)}`;
}

export function publicOrderStatusPath(publicSlug: string | null | undefined, orderId: string, accessToken: string) {
  const slug = publicSlug?.trim();
  const query = `orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(accessToken)}`;
  return slug ? `/m/${slug}?${query}` : `/api/public/event-map-orders/${orderId}/status?token=${encodeURIComponent(accessToken)}`;
}
