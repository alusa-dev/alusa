import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMatriculaPausaResumoRequest: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/enrollments/services/enrollments-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/enrollments/services/enrollments-service')>();
  return { ...actual, getMatriculaPausaResumoRequest: mocks.getMatriculaPausaResumoRequest };
});

import { PauseRegularizationDialog } from '@/features/enrollments/components/PauseRegularizationDialog';

describe('UI de regularização de pausa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMatriculaPausaResumoRequest.mockResolvedValue({
      regularizacaoPausa: {
        elegivel: true,
        exigeRegularizacao: true,
        codigo: null,
        mensagem: 'O prazo venceu e o contrato está vigente. A justificativa pode ser enviada.',
      },
    });
  });

  it('envia justificativa e deixa a retomada como decisão separada', async () => {
    const onConfirm = vi.fn();
    render(
      <PauseRegularizationDialog
        open
        matriculaId="matricula-pausada"
        alunoNome="João E2E"
        submitting={false}
        canSubmit
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/A regularização não reativa a matrícula nem altera cobranças/)).toBeInTheDocument();
    expect(await screen.findByText(/O prazo venceu e o contrato está vigente/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Justificativa para regularizar o prazo da pausa'), {
      target: { value: 'A instituição confirmou a manutenção da pausa.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Regularizar prazo' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('A instituição confirmou a manutenção da pausa.'));
    expect(screen.queryByRole('button', { name: /Retomar matrícula|Reativar matrícula/ })).not.toBeInTheDocument();
  });

  it('desabilita o envio e apresenta o motivo retornado pelo servidor quando não elegível', async () => {
    mocks.getMatriculaPausaResumoRequest.mockResolvedValueOnce({
      regularizacaoPausa: {
        elegivel: false,
        exigeRegularizacao: false,
        codigo: 'PRAZO_RETORNO_NAO_VENCIDO',
        mensagem: 'A regularização só pode ser enviada depois que a data prevista de retorno vencer.',
      },
    });
    const onConfirm = vi.fn();
    render(
      <PauseRegularizationDialog
        open
        matriculaId="matricula-pausada"
        alunoNome="João E2E"
        submitting={false}
        canSubmit
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByText(/depois que a data prevista de retorno vencer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regularizar prazo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Regularizar prazo' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('desabilita o envio e mostra erro quando não consegue carregar a elegibilidade', async () => {
    mocks.getMatriculaPausaResumoRequest.mockRejectedValueOnce(new Error('Não foi possível confirmar o contrato.'));
    render(
      <PauseRegularizationDialog
        open
        matriculaId="matricula-pausada"
        alunoNome="João E2E"
        submitting={false}
        canSubmit
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o contrato.');
    expect(screen.getByRole('button', { name: 'Regularizar prazo' })).toBeDisabled();
  });
});
