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

  it('shows only the latest notification per channel with masked recipients and truthful states', async () => {
    mocks.getHistory.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({
      email: [
        { id: 'email-old', status: 'FAILED', attempts: 3, lastErrorCode: 'TEMP', lastError: 'debug failure', providerEmailId: null, recipientEmail: 'longaddress@gmail.com', createdAt: '2026-10-30T00:01:00.000Z', processedAt: '2026-10-30T00:02:00.000Z' },
        { id: 'email-new', status: 'SENT', attempts: 1, lastErrorCode: null, lastError: null, providerEmailId: 'provider-1', recipientEmail: 'longaddress@gmail.com', createdAt: '2026-10-30T00:03:00.000Z', processedAt: '2026-10-30T00:04:00.000Z' },
      ],
      whatsapp: [
        { id: 'job-old', status: 'FAILED', attempts: 3, lastErrorCode: 'TEMP', lastError: 'retry details', providerMessageId: null, providerAccepted: false, recipientPhone: '+5511999990087', createdAt: '2026-10-30T00:05:00.000Z', processedAt: '2026-10-30T00:06:00.000Z' },
        { id: 'job-new', status: 'SENT', attempts: 1, lastErrorCode: null, lastError: null, providerMessageId: null, providerAccepted: false, recipientPhone: '+5511999990087', createdAt: '2026-10-30T00:07:00.000Z', processedAt: null },
      ],
    });
    render(<ContratoDetalhesFeature contratoId="contract-1" />);
    expect(await screen.findByText('Não foi possível carregar o histórico de assinatura.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Envio pendente para · (••) •••••-0087')).toBeInTheDocument());
    expect(screen.getByText('E-mail enviado para · l***@gmail.com')).toBeInTheDocument();
    expect(screen.getAllByText('Envio por e-mail')).toHaveLength(1);
    expect(screen.getAllByText('Envio por WhatsApp')).toHaveLength(1);
    expect(screen.queryByText(/Aceito pelo provedor|tentativas|debug failure|retry details/i)).not.toBeInTheDocument();
  });

  it('keeps processing, failed, and provider-confirmed states distinct', async () => {
    mocks.getHistory.mockResolvedValue({
      email: [{ id: 'email-processing', status: 'PROCESSING', attempts: 1, lastErrorCode: null, lastError: null, providerEmailId: null, recipientEmail: 'luisa@gmail.com', createdAt: '2026-10-30T00:01:00.000Z', processedAt: null }],
      whatsapp: [{ id: 'whatsapp-failed', status: 'FAILED', attempts: 2, lastErrorCode: 'TEMP', lastError: 'internal detail', providerMessageId: null, providerAccepted: false, recipientPhone: '+5511999990087', createdAt: '2026-10-30T00:02:00.000Z', processedAt: null }],
    });
    const { rerender } = render(<ContratoDetalhesFeature contratoId="contract-1" />);
    expect(await screen.findByText('Envio em andamento para · l***@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível enviar para · (••) •••••-0087')).toBeInTheDocument();
    expect(screen.queryByText('internal detail')).not.toBeInTheDocument();

    mocks.getHistory.mockResolvedValue({
      email: [],
      whatsapp: [{ id: 'whatsapp-confirmed', status: 'SENT', attempts: 1, lastErrorCode: null, lastError: null, providerMessageId: 'provider-1', providerAccepted: true, recipientPhone: '+5511999990087', createdAt: '2026-10-30T00:03:00.000Z', processedAt: '2026-10-30T00:04:00.000Z' }],
    });
    rerender(<ContratoDetalhesFeature contratoId="contract-2" />);
    expect(await screen.findByText('Mensagem enviada para · (••) •••••-0087')).toBeInTheDocument();
  });
});
