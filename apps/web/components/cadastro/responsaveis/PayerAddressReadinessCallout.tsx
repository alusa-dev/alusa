'use client';

import {
  getPayerAddressReadinessCalloutCopy,
  type PayerAddressIssue,
  type PayerAddressReadinessCalloutContext,
} from '@alusa/lib/client';

import { InfoCallout, InfoCalloutLink } from '@/components/ui/info-callout';

type PayerAddressReadinessCalloutProps = {
  issues: PayerAddressIssue[];
  context?: PayerAddressReadinessCalloutContext;
  responsavelId?: string | null;
  className?: string;
};

export function PayerAddressReadinessCallout({
  issues,
  context = 'responsavel-form',
  responsavelId,
  className,
}: PayerAddressReadinessCalloutProps) {
  const { label, detail } = getPayerAddressReadinessCalloutCopy(issues, context);
  const showLink = context === 'charge-action' && responsavelId;

  return (
    <InfoCallout variant="warning" size="sm" title={label} className={className}>
      {detail}
      {showLink ? (
        <>
          {' '}
          <InfoCalloutLink href={`/responsaveis/${responsavelId}`} calloutVariant="warning">
            Corrigir cadastro
          </InfoCalloutLink>
        </>
      ) : null}
    </InfoCallout>
  );
}
