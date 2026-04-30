import type { BadgeVariant } from '@/components/ui/badge';
import type { LedgerEntryType, LedgerEntryStatus } from '../dtos';

export function getTypeBadgeVariant(type: LedgerEntryType): BadgeVariant {
  switch (type) {
    case 'RECEITA': return 'success';
    case 'TAXA': return 'warning';
    case 'ESTORNO': return 'destructive';
    case 'TRANSFERENCIA': return 'info';
    case 'ANTECIPACAO': return 'default';
    case 'AJUSTE': return 'neutral';
    default: return 'neutral';
  }
}

export function getStatusBadgeVariant(status: LedgerEntryStatus): BadgeVariant {
  switch (status) {
    case 'CONFIRMADO': return 'success';
    case 'CANCELADO': return 'destructive';
    default: return 'neutral';
  }
}
