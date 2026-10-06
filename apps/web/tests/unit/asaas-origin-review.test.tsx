import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AsaasOriginReview } from '../../app/(app)/admin/finance/reconciliation/origins/review';

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => ({ success: true, data }) } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('AsaasOriginReview', () => {
  it('exibe o tenant e exige confirmação e justificativa para classificar recurso EXTERNAL', async () => {
    const preview = {
      contaId: 'conta-a', total: 1, pageSize: 20, nextCursor: null,
      items: [{ subscriptionId: 'sub-external', evidence: ['EVENTS_STORED_FOR_TENANT'], eligible: true, conflict: null }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ changed: true }))
      .mockResolvedValueOnce(jsonResponse({ ...preview, items: [{ ...preview.items[0], eligible: false, conflict: 'ALREADY_EXTERNAL' }] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AsaasOriginReview />);
    expect(await screen.findByText(/conta conta-a/i)).toBeInTheDocument();
    expect(screen.getByText(/Origem desconhecida · elegível para análise/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Motivo/evidência da confirmação'), {
      target: { value: 'Confirmado com a escola no Asaas' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar como externa' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({
      resourceType: 'SUBSCRIPTION', asaasId: 'sub-external', origin: 'EXTERNAL',
      reason: 'Confirmado com a escola no Asaas',
    });
    expect(await screen.findByText('Recurso classificado e auditado.')).toBeInTheDocument();
  });

  it('só oferece reclassificação ALUSA quando a prévia encontrou vínculo local', async () => {
    const preview = {
      contaId: 'conta-a', total: 1, pageSize: 20, nextCursor: null,
      items: [{ subscriptionId: 'sub-local', evidence: ['LOCAL_SUBSCRIPTION_RECORD'], eligible: false, conflict: 'LOCAL_SUBSCRIPTION_EXISTS' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ changed: true, reclassified: true }))
      .mockResolvedValueOnce(jsonResponse(preview));
    vi.stubGlobal('fetch', fetchMock);

    render(<AsaasOriginReview />);
    expect(await screen.findByText(/Gerenciada pela Alusa · vínculo local/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar como externa' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Motivo/evidência da confirmação'), {
      target: { value: 'Vínculo interno verificado' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar como gerenciada pela Alusa' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({
      resourceType: 'SUBSCRIPTION', asaasId: 'sub-local', origin: 'ALUSA',
      reason: 'Vínculo interno verificado',
    });
  });
});
