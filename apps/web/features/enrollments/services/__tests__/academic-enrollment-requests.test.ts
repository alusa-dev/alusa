import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formalizeAcademicTransferRequest,
  registerPendingAcademicTransferRequest,
  regularizePauseRequest,
} from '../enrollments-service';

const fetchMock = vi.fn();

describe('academic enrollment administrative requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('validates and submits a pause regularization reason', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'operation-1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await regularizePauseRequest({ id: 'matricula-1', payload: { motivo: '  Pausa confirmada pela escola  ' } });

    expect(fetchMock).toHaveBeenCalledWith('/api/matriculas/matricula-1/regularizar-pausa', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ motivo: 'Pausa confirmada pela escola' }),
    }));
  });

  it('rejects an invalid transfer reason before sending a request', async () => {
    vi.stubGlobal('fetch', fetchMock);

    await expect(registerPendingAcademicTransferRequest({
      destinationLinkId: 'destination-1',
      payload: { origemVinculoId: 'source-1', motivo: 'curto' },
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a pending transfer and parses the persisted relation', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      id: 'transfer-1',
      status: 'PENDENTE',
      origemVinculoId: 'source-1',
      destinoVinculoId: 'destination-1',
      motivo: 'Transferência documentada pela família.',
      solicitadaPor: 'admin-1',
      formalizadaEm: null,
      formalizadaPor: null,
    } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await registerPendingAcademicTransferRequest({
      destinationLinkId: 'destination-1',
      payload: { origemVinculoId: 'source-1', motivo: 'Transferência documentada pela família.' },
    });

    expect(result).toMatchObject({ id: 'transfer-1', status: 'PENDENTE', destinoVinculoId: 'destination-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/matriculas/vinculos-academicos/destination-1/transferencia', expect.objectContaining({ method: 'POST' }));
  });

  it('maps an already formalized conflict to clear text', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'TRANSFERENCIA_JA_FORMALIZADA' } }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(formalizeAcademicTransferRequest('destination-1')).rejects.toThrow('Esta transferência já foi formalizada.');
    expect(fetchMock).toHaveBeenCalledWith('/api/matriculas/vinculos-academicos/destination-1/transferencia/formalizar', expect.objectContaining({ method: 'PATCH' }));
  });
});
