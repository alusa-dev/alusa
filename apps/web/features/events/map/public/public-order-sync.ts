/** Applies an async result only while the checkout still displays its order. */
export function updatePublicOrderIfCurrent<T extends { orderId: string }>(
  current: T | null,
  requestedOrderId: string,
  update: (_order: T) => T,
): T | null {
  return current?.orderId === requestedOrderId ? update(current) : current;
}
