'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { KycAreaStatus } from '../constants';
import { statusBadge } from '../constants';

type Props = {
  label: string;
  status: KycAreaStatus;
};

export function KycStatusArea({ label, status }: Props) {
  const { label: badgeLabel, variant } = statusBadge(status);
  return (
    <div className="flex items-center justify-between py-2 px-3 border rounded-md">
      <span className="text-sm font-medium">{label}</span>
      <Badge variant={variant}>{badgeLabel}</Badge>
    </div>
  );
}
