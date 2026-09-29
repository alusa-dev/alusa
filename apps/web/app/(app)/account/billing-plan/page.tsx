import { PlatformBillingFeature } from '@/features/platform-billing/PlatformBillingFeature';

type ContaPlanoFaturamentoPageProps = {
  searchParams?: Promise<{
    checkout?: string;
  }>;
};

export default async function ContaPlanoFaturamentoPage({ searchParams }: ContaPlanoFaturamentoPageProps) {
  const resolvedSearchParams = await searchParams;
  const checkout = resolvedSearchParams?.checkout === 'success' || resolvedSearchParams?.checkout === 'cancel'
    ? resolvedSearchParams.checkout
    : null;

  return <PlatformBillingFeature checkoutState={checkout} />;
}
