import { describe, expect, it } from 'vitest';
import ContaPlanoFaturamentoPage from '@/app/(app)/account/billing-plan/page';

describe('billing plan return query parsing', () => {
  it.each(['success', 'canceled'] as const)('passes setup=%s to the billing feature', async (setup) => {
    const element = await ContaPlanoFaturamentoPage({ searchParams: Promise.resolve({ setup }) });
    expect(element.props).toMatchObject({ setupState: setup });
  });

  it('does not treat a setup return as subscription checkout success', async () => {
    const element = await ContaPlanoFaturamentoPage({ searchParams: Promise.resolve({ setup: 'success' }) });
    expect(element.props).toMatchObject({ setupState: 'success', checkoutState: null });
  });
});
