export type PublicMapOrderStatus =
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PublicSeatStatus =
  | 'AVAILABLE'
  | 'HELD'
  | 'SOLD'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export function isTerminalPublicOrderStatus(status: string): boolean {
  return status === 'CONFIRMED' || status === 'EXPIRED' || status === 'CANCELLED' || status === 'REFUNDED';
}

export function publicOrderStatusLabel(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmado';
    case 'PAYMENT_PENDING':
      return 'Aguardando pagamento';
    case 'EXPIRED':
      return 'Expirado';
    case 'CANCELLED':
      return 'Cancelado';
    case 'REFUNDED':
      return 'Estornado';
    case 'PARTIALLY_REFUNDED':
      return 'Parcialmente estornado';
    default:
      return status;
  }
}

export function publicSeatStatusLabel(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return 'Disponível';
    case 'HELD':
      return 'Reservado';
    case 'SOLD':
      return 'Vendido';
    case 'BLOCKED':
      return 'Bloqueado';
    case 'UNAVAILABLE':
      return 'Indisponível';
    default:
      return status;
  }
}

export function publicSeatTooltip(status: string, displayLabel: string, sectionName: string): string {
  return `${publicSeatStatusLabel(status)} — ${displayLabel} (${sectionName})`;
}

export function formatReservationCountdown(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expirado';

  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}min restantes`;
  return `${minutes}min restantes`;
}
