/** Roles authorized by the financial refund endpoint for an event order. */
export function canRequestEventRefund(role: string | null | undefined): boolean {
  const normalizedRole = role?.trim().toUpperCase();
  return normalizedRole === 'ADMIN' || normalizedRole === 'FINANCEIRO';
}
