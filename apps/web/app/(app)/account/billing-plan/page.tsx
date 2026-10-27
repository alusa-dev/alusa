import React from 'react';
import { PlatformBillingFeature } from '@/features/platform-billing/PlatformBillingFeature';

type ContaPlanoFaturamentoPageProps = {
  searchParams?: Promise<{
    checkout?: string;
    setup?: string;
  }>;
};

export default async function ContaPlanoFaturamentoPage({ searchParams }: ContaPlanoFaturamentoPageProps) {
  const resolvedSearchParams = await searchParams;
  const checkout = resolvedSearchParams?.checkout === 'success' || resolvedSearchParams?.checkout === 'cancel'
    ? resolvedSearchParams.checkout
    : null;
  const setup = resolvedSearchParams?.setup === 'success' || resolvedSearchParams?.setup === 'canceled'
    ? resolvedSearchParams.setup
    : null;

  return <PlatformBillingFeature checkoutState={checkout} setupState={setup} />;
}
