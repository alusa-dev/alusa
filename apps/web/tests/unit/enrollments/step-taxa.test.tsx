import { useCallback, useMemo, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StepTaxa } from '@/features/enrollments/components/wizard/steps/StepTaxa';
import type { WizardState } from '@/features/enrollments/components/wizard/types';

describe('StepTaxa', () => {
  it('sincroniza as mudanças da taxa sem criar atualizações recursivas', async () => {
    const update = vi.fn();

    function Harness() {
      const [state, setState] = useState<WizardState>({
        contaId: 'conta-e2e',
        modoMatricula: 'INDIVIDUAL',
        modoTurmas: 'TURMAS',
        turmaIds: [],
        alunosFamiliares: [],
        criarCobranca: true,
        confirmacaoRevisao: false,
        notificationChannels: [],
        taxaIsenta: false,
        taxaMatricula: 120,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: false,
      });
      const applyUpdate = useCallback((patch: Partial<WizardState>) => {
        update(patch);
        setState((previous) => ({ ...previous, ...patch }));
      }, []);
      const ctx = useMemo(() => ({
        state,
        step: 'taxa' as const,
        steps: ['taxa' as const],
        canGoBack: true,
        goNext: () => undefined,
        goBack: () => undefined,
        update: applyUpdate,
        reset: () => undefined,
      }), [state, applyUpdate]);

      return <StepTaxa ctx={ctx} />;
    }

    const rendered = render(<Harness />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole('button', { name: /Isentar taxa/ }));
    fireEvent.change(rendered.getByLabelText('Justificativa da isenção'), {
      target: { value: 'Isenção validada no teste.' },
    });
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      taxaIsenta: true,
      taxaJustificativa: 'Isenção validada no teste.',
      gerarCobrancaTaxa: false,
    })));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(rendered.getByText('Status da taxa')).toBeTruthy();
    rendered.unmount();
  });
});
