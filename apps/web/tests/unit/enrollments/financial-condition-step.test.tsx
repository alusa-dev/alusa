import React, { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StepFinancialCondition } from '@/features/enrollments/components/wizard/steps/StepFinancialCondition';
import { useEnrollmentWizard } from '@/features/enrollments/components/wizard/hooks/useEnrollmentWizard';
import { canAdvanceFinancialCondition } from '@/features/enrollments/components/wizard/financial-condition';
import type { WizardState } from '@/features/enrollments/components/wizard/types';

afterEach(cleanup);

const seed: Partial<WizardState> = {
  condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo: 'Justificativa personalizada',
  condicaoValidadeModo: 'MATRICULA', planoValor: 70,
};

function Harness() {
  const ctx = useEnrollmentWizard();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => { ctx.update(seed); setReady(true); }, [ctx.update]);
  return ready ? <>
    {visible && <StepFinancialCondition ctx={ctx} />}
    <button disabled={!canAdvanceFinancialCondition(ctx.state)}>Avançar</button>
    <button onClick={() => setVisible((value) => !value)}>Alternar etapa</button>
  </> : null;
}

describe('interações da condição financeira', () => {
  it('libera a isenção até o término antes de preencher o contrato e exige motivo', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByLabelText('Descreva o motivo'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Descreva o motivo'), { target: { value: 'Bolsa institucional' } });
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(false);
  });

  it('exige data no período determinado e mantém a escolha ao voltar à etapa', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Por período determinado'));
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Alternar etapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alternar etapa' }));
    expect((screen.getByLabelText('Por período determinado') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Data de término'), { target: { value: '2027-12-31' } });
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText('Até o término da matrícula'));
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(false);
  });

  it('limpa o motivo ao retornar ao pagamento normal e inicializa bolsa em 50%', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Pagamento normal'));
    expect(screen.queryByLabelText('Descreva o motivo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText('Bolsa parcial'));
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('50');
    expect(screen.getByRole('button', { name: 'Avançar' }).hasAttribute('disabled')).toBe(true);
  });
});
