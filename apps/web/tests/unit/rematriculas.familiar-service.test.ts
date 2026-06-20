import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRematriculaFamiliarRequest,
  previewRematriculaFamiliarRequest,
  type CreateRematriculaFamiliarInput,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';

const baseInput: CreateRematriculaFamiliarInput = {
  contaId: 'conta-1',
  responsavelId: 'resp-1',
  modoTurmas: 'TURMAS',
  planoId: 'plano-global',
  comboId: null,
  itens: [
    { matriculaId: 'mat-1', decision: 'REMATRICULAR_AGORA', turmaId: 'turma-a' },
    { matriculaId: 'mat-2', decision: 'NAO_CONTINUARA', turmaId: null },
  ],
  dataInicio: '2026-01-10T00:00:00.000Z',
  dataFimContrato: '2027-01-10T00:00:00.000Z',
  formaPagamento: 'BOLETO',
  vencimentoDia: 5,
  uiRequestId: 'resp-1:1700000000000',
};

const okPreviewResponse = {
  previewId: 'preview-1',
  previewHash: 'hash-1',
  blocks: [],
  warnings: [],
  sourceBillingAction: 'NONE',
  financialGroups: [],
};

const okResponse = {
  familyId: 'fam-1',
  status: 'ATIVO',
  results: [],
};

describe('rematricula familiar request payload', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => okResponse,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('em modo TURMAS aplica plano global e zera combo em todos os itens', async () => {
    await createRematriculaFamiliarRequest({
      ...baseInput,
      modoTurmas: 'TURMAS',
      planoId: 'plano-global',
      comboId: null,
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.planoId).toBeUndefined();
    expect(body.comboId).toBeUndefined();
    expect(body.itens).toHaveLength(2);
    for (const item of body.itens) {
      expect(item.planoId).toBe('plano-global');
      expect(item.comboId).toBeNull();
    }
    expect(body.uiRequestId).toBe('resp-1:1700000000000');
  });

  it('em modo COMBO aplica combo global e zera plano em todos os itens', async () => {
    await createRematriculaFamiliarRequest({
      ...baseInput,
      modoTurmas: 'COMBO',
      planoId: null,
      comboId: 'combo-global',
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    for (const item of body.itens) {
      expect(item.comboId).toBe('combo-global');
      expect(item.planoId).toBeNull();
    }
  });

  it('em modo COMBO aceita combo por item sem combo global', async () => {
    await createRematriculaFamiliarRequest({
      ...baseInput,
      modoTurmas: 'COMBO',
      planoId: null,
      comboId: null,
      itens: [
        { matriculaId: 'mat-1', decision: 'REMATRICULAR_AGORA', turmaId: 'turma-a', comboId: 'combo-a' },
        { matriculaId: 'mat-2', decision: 'NAO_CONTINUARA', turmaId: null, comboId: 'combo-b' },
      ],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.itens[0].comboId).toBe('combo-a');
    expect(body.itens[1].comboId).toBe('combo-b');
  });

  it('normaliza ids vazios e decisão ausente no preview', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => okPreviewResponse,
    });

    await previewRematriculaFamiliarRequest({
      ...baseInput,
      itens: [{ matriculaId: 'mat-1', turmaId: '', comboId: '' }],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.itens[0].decision).toBe('DECIDIR_DEPOIS');
    expect(body.itens[0].turmaId).toBeNull();
    expect(body.itens[0].comboId).toBeNull();
    expect(body.taxaMatricula).toBe(0);
  });

  it('lança erro com mensagem da API em caso de falha', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: { message: 'Informe um combo por aluno.' } }),
    });

    await expect(
      createRematriculaFamiliarRequest({
        ...baseInput,
        modoTurmas: 'COMBO',
        comboId: null,
      }),
    ).rejects.toThrow('Informe um combo por aluno.');
  });

  it('traduz erro de payload inválido para mensagem orientativa', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'PAYLOAD_INVALIDO',
          message: 'Required',
          details: [{ path: ['vencimentoDia'], message: 'Expected number, received string', code: 'invalid_type' }],
        },
      }),
    });

    await expect(previewRematriculaFamiliarRequest(baseInput)).rejects.toThrow(
      'Informe um dia de vencimento entre 1 e 28.',
    );
  });
});
