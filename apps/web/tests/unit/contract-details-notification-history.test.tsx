import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getContract: vi.fn(), getHistory: vi.fn(), push: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, back: mocks.back }) }));
vi.mock('@/lib/observability/client-operational-log', () => ({ logClientOperationalEvent: vi.fn() }));
vi.mock('@/features/contracts/services/contracts-service', () => ({
  getContract: mocks.getContract, getContractNotificationHistory: mocks.getHistory,
  createContract: vi.fn(), regenerateContract: vi.fn(), regenerateEventContract: vi.fn(), getEventContract: vi.fn(), resendContractNotification: vi.fn(),
}));
vi.mock('@/features/contracts/components/ShareContractDialog', () => ({ ShareContractDialog: () => null }));
vi.mock('@/features/contracts/components/PDFViewer', () => ({ PDFViewer: () => <div>PDF</div> }));

import { ContratoDetalhesFeature } from '@/features/contracts/ContractDetailsFeature';

describe('contract details notification history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContract.mockResolvedValue({
      id: 'contract-1', status: 'PENDENTE', modelo: null, arquivoPdfUrl: '', arquivoPdfAssinadoUrl: null,
      tokenPublico: 'token', tokenExpiraEm: null, createdAt: '2026-10-30T00:00:00.000Z',
      matriculaId: 'enrollment-1', matricula: { aluno: { nome: 'Aluno Teste', cpf: null } },
      assinadoPor: null, assinadoCpf: null, assinadoEm: null, hashAssinatura: null,
    });
  });
  afterEach(cleanup);

  it('shows history load failure and retry, and does not label queued WhatsApp as provider accepted', async () => {
    mocks.getHistory.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({
      email: [], whatsapp: [{ id: 'job-1', status: 'SENT', attempts: 1, lastErrorCode: null, lastError: null, providerMessageId: null, providerAccepted: false, createdAt: '2026-10-30T00:00:00.000Z', processedAt: null }],
    });
    render(<ContratoDetalhesFeature contratoId="contract-1" />);
    expect(await screen.findByText('Não foi possível carregar o histórico de assinatura.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Enfileirado para envio')).toBeInTheDocument());
    expect(screen.queryByText(/WhatsApp · Aceito pelo provedor/)).not.toBeInTheDocument();
  });
});
