'use client';

import { Badge } from '@/components/ui/badge';

import { SALE_STATUS_LABELS } from '../services/sales-service';

type SaleStatus = keyof typeof SALE_STATUS_LABELS;

const VARIANT_BY_STATUS: Record<SaleStatus, React.ComponentProps<typeof Badge>['variant']> = {
  CONCLUIDA: 'success',
  PENDENTE: 'warning',
  VINCULADA_MENSALIDADE: 'warning',
  CANCELADA: 'neutral',
};

interface SaleStatusBadgeProps {
  status: SaleStatus;
}

export function SaleStatusBadge({ status }: SaleStatusBadgeProps) {
  return <Badge variant={VARIANT_BY_STATUS[status]}>{SALE_STATUS_LABELS[status]}</Badge>;
}
