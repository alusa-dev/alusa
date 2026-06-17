import { Badge } from '@/components/ui/badge';
import type { ChargeDisplayStatusDTO } from '@/lib/finance/charge-display-status';

type ChargeDisplayStatusBadgeProps = {
  displayStatus: ChargeDisplayStatusDTO;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
};

function mapVariant(variant: ChargeDisplayStatusDTO['variant']) {
  return variant === 'danger' ? 'destructive' : variant;
}

export function ChargeDisplayStatusBadge({
  displayStatus,
  size = 'sm',
  className,
}: ChargeDisplayStatusBadgeProps) {
  return (
    <Badge
      variant={mapVariant(displayStatus.variant)}
      size={size}
      className={className}
    >
      {displayStatus.label}
    </Badge>
  );
}
