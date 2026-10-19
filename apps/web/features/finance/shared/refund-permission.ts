export function canRequestFinancialRefund(role: string | null | undefined): boolean {
  const normalizedRole = role?.trim().toUpperCase();
  return normalizedRole === 'ADMIN' || normalizedRole === 'FINANCEIRO';
}
