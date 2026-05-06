import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRematriculaFamiliarRequest,
  type CreateRematriculaFamiliarInput,
} from '@/features/cadastro/rematriculas/services/rematriculas-service';

const baseInput: Omit<CreateRematriculaFamiliarInput, 'modoTurmas' | 'planoId' | 'comboId'> = {
  contaId: 'conta-1',
  responsavelId: 'resp-1',
  itens: [
    { matriculaId: 'mat-1', turmaId: 'turma-a' },
    { matriculaId: 'mat-2', turmaId: null },
  ],
  dataInicio: '2026-01-10T00:00:00.000Z',
  dataFimContrato: '2027-01-10T00:00:00.000Z',
  formaPagamento: 'BOLETO',
  vencimentoDia: 5,
};

const okResponse = {
  familyId: 'fam-1',
  status: 'ATIVO',
  results: [],
};

describe('createRematriculaFamiliarRequest payload', () => {
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

    expect(body.modoTurmas).toBe('TURMAS');
    expect(body.planoId).toBe('plano-global');
    expect(body.comboId).toBeNull();
    expect(body.itens).toHaveLength(2);
    for (const item of body.itens) {
      expect(item.planoId).toBe('plano-global');
      expect(item.comboId).toBeNull();
    }
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

    expect(body.modoTurmas).toBe('COMBO');
    expect(body.planoId).toBeNull();
    expect(body.comboId).toBe('combo-global');
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
        { matriculaId: 'mat-1', turmaId: 'turma-a', comboId: 'combo-a' },
        { matriculaId: 'mat-2', turmaId: null, comboId: 'combo-b' },
      ],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.comboId).toBeNull();
    expect(body.itens[0].comboId).toBe('combo-a');
    expect(body.itens[1].comboId).toBe('combo-b');
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
});
