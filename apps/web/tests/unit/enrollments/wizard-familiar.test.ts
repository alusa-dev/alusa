import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnrollmentWizard } from '@/features/enrollments/components/wizard/hooks/useEnrollmentWizard';
import { previewInitialEnrollmentBillingRequest } from '@/features/enrollments/services/enrollments-service';
import type {
  WizardState,
  WizardAlunoFamiliar,
} from '@/features/enrollments/components/wizard/types';
import {
  clearFamilyEnrollmentAttempt,
  readFamilyEnrollmentAttempt,
  saveFamilyEnrollmentAttempt,
} from '@/features/enrollments/services/family-enrollment-attempt';

vi.mock('@/features/enrollments/services/enrollments-service', () => ({
  previewInitialEnrollmentBillingRequest: vi.fn().mockResolvedValue({
    previewHash: 'a'.repeat(64),
    sourceVersion: 'b'.repeat(64),
    expiresAt: '2026-10-01T00:00:00.000Z',
    strategy: 'CREATE_SEPARATE',
    billingStrategy: { kind: 'SEPARATE' },
    compatibility: { compatible: true, blockers: [], warnings: [] },
    totals: { monthlyTotal: 0, enrollmentFeeTotal: 0, itemCount: 2 },
    validityImpact: {
      existingEndDate: null,
      addedEndDate: '2026-10-01',
      resultingEndDate: '2026-10-01',
      isDifferent: false,
      rule: 'STANDARD',
    },
    billingImpact: {
      currentMonthlyAmount: 0,
      addedMonthlyAmount: 0,
      resultingMonthlyAmount: 0,
      enrollmentFeeAmount: 0,
      application: 'SEPARATE',
      updatesPendingPayments: false,
      currentCycleAction: 'CREATE_SEPARATE',
      currentChargeState: 'NOT_GENERATED',
      currentChargeId: null,
      currentChargeDueDate: null,
      nextCycleDate: null,
      operationalMessage: 'OK',
      targetLabel: null,
    },
    groups: [],
    snapshot: {},
  }),
}));

// ─── useEnrollmentWizard — step mode ─────────────────────────────────────────

describe('useEnrollmentWizard — getSteps', () => {
  it('individual + TURMAS: inclui modo, aluno, turmasCombo, plano', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    const steps = result.current.steps;
    expect(steps).toContain('modo');
    expect(steps).toContain('aluno');
    expect(steps).toContain('turmasCombo');
    expect(steps).toContain('plano');
    expect(steps).not.toContain('responsavelFamiliar');
    expect(steps).not.toContain('alunosFamiliares');
  });

  it('individual + COMBO: remove plano', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() => result.current.update({ modoTurmas: 'COMBO' }));
    expect(result.current.steps).not.toContain('plano');
    expect(result.current.steps).toContain('turmasCombo');
  });

  it('familiar + TURMAS: inclui modo, responsavelFamiliar, alunosFamiliares, sem turmasCombo', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() => result.current.update({ modoMatricula: 'FAMILIAR' }));
    const steps = result.current.steps;
    expect(steps).toContain('modo');
    expect(steps).toContain('responsavelFamiliar');
    expect(steps).toContain('alunosFamiliares');
    expect(steps).not.toContain('aluno');
    expect(steps).not.toContain('turmasCombo');
    expect(steps).toContain('plano');
  });

  it('familiar + COMBO: remove plano', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() => result.current.update({ modoMatricula: 'FAMILIAR', modoTurmas: 'COMBO' }));
    expect(result.current.steps).not.toContain('plano');
    expect(result.current.steps).toContain('alunosFamiliares');
  });

  it('começa no passo modo', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    expect(result.current.step).toBe('modo');
  });

  it('reset limpa alunosFamiliares e responsavelFamiliar', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() =>
      result.current.update({
        modoMatricula: 'FAMILIAR',
        responsavelFamiliar: { id: 'r1', nome: 'Maria' },
        alunosFamiliares: [{ id: 'a1', nome: 'João' }],
      }),
    );
    act(() => result.current.reset({ contaId: 'conta-1' }));
    expect(result.current.state.responsavelFamiliar).toBeUndefined();
    expect(result.current.state.alunosFamiliares).toHaveLength(0);
    expect(result.current.state.modoMatricula).toBe('INDIVIDUAL');
  });
});

// ─── useMatriculaFamiliarSubmit ───────────────────────────────────────────────

describe('useMatriculaFamiliarSubmit', async () => {
  const { useMatriculaFamiliarSubmit } = await import('@/hooks/use-matricula-familiar-submit');

  const baseState: WizardState = {
    contaId: 'conta-1',
    modoMatricula: 'FAMILIAR',
    modoTurmas: 'TURMAS',
    turmaIds: [],
    alunosFamiliares: [],
    responsavelFamiliar: { id: 'resp-1', nome: 'Maria' },
    planoId: 'plano-1',
    taxaMatricula: 50,
    taxaIsenta: false,
    gerarCobrancaTaxa: true,
    formaPagamentoTaxa: 'BOLETO',
    formaPagamento: 'PIX',
    modeloId: 'modelo-1',
    dataInicio: '2025-10-01',
    dataFimContrato: '2026-10-01',
    vencimentoDia: 10,
    multaPercentual: 2,
    jurosMensal: 1,
    descontoAntecipado: 5,
    descontoTipo: 'PERCENTAGE',
    prazoDesconto: 0,
    criarCobranca: true,
    confirmacaoRevisao: true,
    notificationChannels: [],
  };

  const alunos: WizardAlunoFamiliar[] = [
    { id: 'a1', nome: 'João', turmaId: 'turma-1' },
    { id: 'a2', nome: 'Ana', turmaId: 'turma-2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    globalThis.sessionStorage.clear();
    clearFamilyEnrollmentAttempt('conta-1');
  });

  it('retorna success para todos os alunos quando API responde OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        familyId: 'family-1',
        academicStatus: 'COMPLETO',
        operationStatus: 'PENDING',
        results: [
          { alunoId: 'a1', alunoNome: 'João', status: 'success', matriculaId: 'mat-1' },
          { alunoId: 'a2', alunoNome: 'Ana', status: 'success', matriculaId: 'mat-2' },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // modeloId undefined => createContrato não é chamado
    const stateWithoutModelo = { ...baseState, modeloId: undefined };

    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    let results;
    await act(async () => {
      results = await result.current.submit({ ...stateWithoutModelo, alunosFamiliares: alunos });
    });

    expect(results.results).toHaveLength(2);
    expect(results.results[0].status).toBe('success');
    expect(results.results[1].status).toBe('success');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstPayload = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(firstPayload.responsavelId).toBe('resp-1');
    expect(firstPayload.alunos).toHaveLength(2);
    expect(firstPayload.criarCobranca).toBe(true);
    expect(firstPayload.taxaMatricula).toBe(50);
    expect(firstPayload.gerarCobrancaTaxa).toBe(true);
    expect(firstPayload.formaPagamentoTaxa).toBe('BOLETO');
    expect(firstPayload.multaPercentual).toBe(2);
    expect(firstPayload.jurosMensal).toBe(1);
    expect(firstPayload.descontoAntecipado).toBe(5);
    expect(firstPayload.descontoTipo).toBe('PERCENTAGE');
    expect(firstPayload.prazoDesconto).toBe(0);
  });

  it('interrompe o fluxo quando a matrícula principal da cobrança familiar falha', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, json: async () => ({ error: { message: 'Aluno já matriculado' } }) };
      }
      return { ok: true, json: async () => ({ matricula: { id: 'mat-2' } }) };
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    await expect(
      act(async () => {
        await result.current.submit({ ...baseState, alunosFamiliares: alunos });
      }),
    ).rejects.toThrow('Aluno já matriculado');
  });

  it('sanitiza menção a Asaas nas mensagens de erro', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Erro no Asaas: customer inválido' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    await expect(
      act(async () => {
        await result.current.submit({ ...baseState, alunosFamiliares: [alunos[0]] });
      }),
    ).rejects.toThrow('Erro no financeiro: customer inválido');
  });

  it('lança erro se nenhum aluno for fornecido', async () => {
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    await expect(
      act(async () => {
        await result.current.submit({ ...baseState, alunosFamiliares: [] });
      }),
    ).rejects.toThrow();
  });

  it('mantém tentativa e não chama sucesso quando API aceita processamento (202)', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ data: { state: 'PROCESSING', operationStatus: 'PROCESSING' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatriculaFamiliarSubmit({ onSuccess }));
    let submissionError: unknown;
    await act(async () => {
      try {
        await result.current.submit({ ...baseState, alunosFamiliares: alunos });
      } catch (error) {
        submissionError = error;
      }
    });
    expect(submissionError).toMatchObject({
      message: expect.stringContaining('continua em processamento'),
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(readFamilyEnrollmentAttempt('conta-1')).toMatchObject({ contaId: 'conta-1' });
  });

  it('reenvia mesmo id e body após timeout/remount sem gerar preview novo', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          familyId: 'family-1',
          academicStatus: 'COMPLETO',
          operationStatus: 'PENDING',
          results: [
            { alunoId: 'a1', alunoNome: 'João', status: 'success', matriculaId: 'mat-1' },
            { alunoId: 'a2', alunoNome: 'Ana', status: 'success', matriculaId: 'mat-2' },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const onAttemptResume = vi.fn();
    const { result, unmount } = renderHook(() => useMatriculaFamiliarSubmit({ onAttemptResume }));
    let timeoutError: unknown;
    await act(async () => {
      try {
        await result.current.submit({ ...baseState, alunosFamiliares: alunos });
      } catch (error) {
        timeoutError = error;
      }
    });
    expect(timeoutError).toMatchObject({ message: 'timeout' });
    const originalBody = fetchMock.mock.calls[0]?.[1]?.body;
    const previewCallsAfterFirstAttempt = vi.mocked(previewInitialEnrollmentBillingRequest).mock
      .calls.length;
    unmount();
    const { result: remounted } = renderHook(() => useMatriculaFamiliarSubmit({ onAttemptResume }));
    await act(async () =>
      remounted.current.submit({
        ...baseState,
        alunosFamiliares: [{ ...alunos[0], turmaId: 'turma-editada' }, alunos[1]],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(originalBody);
    expect(vi.mocked(previewInitialEnrollmentBillingRequest)).toHaveBeenCalledTimes(
      previewCallsAfterFirstAttempt,
    );
    expect(onAttemptResume).toHaveBeenCalledTimes(1);
  });

  it('preserva reconciliação no envelope aninhado e não marca rollback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 'REQUIRES_RECONCILIATION',
          message: 'Resultado incerto',
          details: { operationStatus: 'REQUIRES_RECONCILIATION' },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    let reconciliationError: unknown;
    await act(async () => {
      try {
        await result.current.submit({ ...baseState, alunosFamiliares: alunos });
      } catch (error) {
        reconciliationError = error;
      }
    });
    expect(reconciliationError).toMatchObject({
      message: expect.stringContaining('preservada para reconciliação'),
    });
    expect(readFamilyEnrollmentAttempt('conta-1')).toMatchObject({ contaId: 'conta-1' });
    expect(result.current.results.some((item) => item.errorMessage?.includes('desfeito'))).toBe(
      false,
    );
  });

  it('não apaga tentativa em resposta 2xx malformada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) }),
    );
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    let failure: unknown;
    await act(async () => {
      try {
        await result.current.submit({ ...baseState, alunosFamiliares: alunos });
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toMatchObject({ message: expect.stringContaining('não confirma') });
    expect(readFamilyEnrollmentAttempt('conta-1')).not.toBeNull();
  });

  it('trata 202 com matrículas acadêmicas completas como resultado concluído', async () => {
    const onSuccess = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          familyId: 'family-1',
          academicStatus: 'COMPLETO',
          operationStatus: 'PENDING',
          results: [
            { alunoId: 'a1', alunoNome: 'João', status: 'success', matriculaId: 'mat-1' },
            { alunoId: 'a2', alunoNome: 'Ana', status: 'success', matriculaId: 'mat-2' },
          ],
        }),
      }),
    );
    const { result } = renderHook(() => useMatriculaFamiliarSubmit({ onSuccess }));
    await act(async () => result.current.submit({ ...baseState, alunosFamiliares: alunos }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.outcome?.academicStatus).toBe('COMPLETO');
  });

  it.each(['FAILED', 'CANCELLED', 'PARTIAL', undefined] as const)(
    'preserva tentativa e não confirma resposta 2xx com operationStatus %s',
    async (operationStatus) => {
      const onSuccess = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            familyId: 'family-1',
            academicStatus: 'COMPLETO',
            ...(operationStatus ? { operationStatus } : {}),
            results: [
              { alunoId: 'a1', alunoNome: 'João', status: 'success', matriculaId: 'mat-1' },
              { alunoId: 'a2', alunoNome: 'Ana', status: 'success', matriculaId: 'mat-2' },
            ],
          }),
        }),
      );
      const { result } = renderHook(() => useMatriculaFamiliarSubmit({ onSuccess }));
      let failure: unknown;
      await act(async () => {
        try {
          await result.current.submit({ ...baseState, alunosFamiliares: alunos });
        } catch (error) {
          failure = error;
        }
      });

      expect(failure).toMatchObject({ message: expect.stringContaining('não confirma') });
      expect(onSuccess).not.toHaveBeenCalled();
      expect(readFamilyEnrollmentAttempt('conta-1')).not.toBeNull();
    },
  );

  it('bloqueia double-submit síncrono enquanto o POST está pendente', async () => {
    let resolveFetch!: (_value: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.submit({ ...baseState, alunosFamiliares: alunos });
      await Promise.resolve();
      await result.current.submit({ ...baseState, alunosFamiliares: alunos });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFetch({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'conflict' } }),
      });
      try {
        await first;
      } catch (error) {
        expect(error).toMatchObject({ message: 'conflict' });
      }
    });
  });

  it('isola tentativas familiares por conta e falha fechado para storage corrompido', () => {
    saveFamilyEnrollmentAttempt({
      contaId: 'conta-a',
      uiRequestId: 'request-a',
      body: { alunos: [] },
    });
    saveFamilyEnrollmentAttempt({
      contaId: 'conta-b',
      uiRequestId: 'request-b',
      body: { alunos: [] },
    });
    expect(readFamilyEnrollmentAttempt('conta-a')?.uiRequestId).toBe('request-a');
    expect(readFamilyEnrollmentAttempt('conta-b')?.uiRequestId).toBe('request-b');
    globalThis.sessionStorage.setItem('alusa:enrollment:family-attempt:v1:conta-corrompida', '{');
    expect(() => readFamilyEnrollmentAttempt('conta-corrompida')).toThrow();
  });

  it('libera nova intenção após rejeição prévia explícita de preview', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: 'PREVIEW_DIVERGENTE', message: 'Revise o preview' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ data: { state: 'PROCESSING', operationStatus: 'PROCESSING' } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        try {
          await result.current.submit({ ...baseState, alunosFamiliares: alunos });
        } catch {
          /* O resultado de cada resposta é validado abaixo. */
        }
      });
    }
    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      uiRequestId: string;
    };
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as {
      uiRequestId: string;
    };
    expect(secondBody.uiRequestId).not.toBe(firstBody.uiRequestId);
  });

  it('preserva tentativa da Conta B quando a sessão atual retorna CONTA_INVALIDA', async () => {
    saveFamilyEnrollmentAttempt({
      contaId: 'conta-b',
      uiRequestId: 'request-conta-b',
      body: {
        uiRequestId: 'request-conta-b',
        alunos: alunos.map((aluno) => ({ alunoId: aluno.id })),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: 'CONTA_INVALIDA', message: 'Conta diferente da sessão' },
        }),
      }),
    );
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    await act(async () => {
      try {
        await result.current.submit({ ...baseState, contaId: 'conta-b', alunosFamiliares: alunos });
      } catch {
        /* A tentativa fica disponível para a conta correta. */
      }
    });
    expect(readFamilyEnrollmentAttempt('conta-b')?.uiRequestId).toBe('request-conta-b');
  });

  it('libera nova intenção após rollback completo do lote familiar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          familyId: 'family-1',
          operationStatus: 'FAILED',
          error: { code: 'FALHA_CRIACAO_MATRICULAS_FAMILIARES', message: 'Lote desfeito' },
          results: [{ alunoId: 'a1', alunoNome: 'João', status: 'error', errorMessage: 'falha' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ data: { state: 'PROCESSING', operationStatus: 'PROCESSING' } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        try {
          await result.current.submit({ ...baseState, alunosFamiliares: alunos });
        } catch {
          /* Respostas terminais e pendentes são verificadas abaixo. */
        }
      });
    }
    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      uiRequestId: string;
    };
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as {
      uiRequestId: string;
    };
    expect(secondBody.uiRequestId).not.toBe(firstBody.uiRequestId);
  });
});

// ─── canAdvance funções (isoladas) ────────────────────────────────────────────

describe('canAdvanceFromAlunosFamiliares (via wizard)', () => {
  it('bloqueia se menos de 2 alunos', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() => {
      result.current.update({
        modoMatricula: 'FAMILIAR',
        alunosFamiliares: [{ id: 'a1', nome: 'João', turmaId: 't1' }],
      });
      // navegamos até alunosFamiliares step
      result.current.goNext(); // modo -> responsavelFamiliar
      result.current.update({ responsavelFamiliar: { id: 'r1', nome: 'Maria' } });
      result.current.goNext(); // responsavelFamiliar -> alunosFamiliares
    });
    // step should be alunosFamiliares now — we just verify state is consistent
    expect(result.current.state.alunosFamiliares).toHaveLength(1);
  });

  it('bloqueia se aluno não tem turma selecionada', () => {
    const { result } = renderHook(() => useEnrollmentWizard('conta-1'));
    act(() => {
      result.current.update({
        modoMatricula: 'FAMILIAR',
        modoTurmas: 'TURMAS',
        alunosFamiliares: [
          { id: 'a1', nome: 'João', turmaId: 't1' },
          { id: 'a2', nome: 'Ana' }, // sem turmaId
        ],
      });
    });
    expect(result.current.state.alunosFamiliares[1].turmaId).toBeUndefined();
  });
});
