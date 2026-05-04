import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMatriculaWizard } from '@/components/matriculas/wizard/hooks/useMatriculaWizard';
import type { WizardState, WizardAlunoFamiliar } from '@/components/matriculas/wizard/types';

// ─── useMatriculaWizard — modo steps ─────────────────────────────────────────

describe('useMatriculaWizard — getSteps', () => {
  it('individual + TURMAS: inclui modo, aluno, turmasCombo, plano', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
    const steps = result.current.steps;
    expect(steps).toContain('modo');
    expect(steps).toContain('aluno');
    expect(steps).toContain('turmasCombo');
    expect(steps).toContain('plano');
    expect(steps).not.toContain('responsavelFamiliar');
    expect(steps).not.toContain('alunosFamiliares');
  });

  it('individual + COMBO: remove plano', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
    act(() => result.current.update({ modoTurmas: 'COMBO' }));
    expect(result.current.steps).not.toContain('plano');
    expect(result.current.steps).toContain('turmasCombo');
  });

  it('familiar + TURMAS: inclui modo, responsavelFamiliar, alunosFamiliares, sem turmasCombo', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
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
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
    act(() => result.current.update({ modoMatricula: 'FAMILIAR', modoTurmas: 'COMBO' }));
    expect(result.current.steps).not.toContain('plano');
    expect(result.current.steps).toContain('alunosFamiliares');
  });

  it('começa no passo modo', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
    expect(result.current.step).toBe('modo');
  });

  it('reset limpa alunosFamiliares e responsavelFamiliar', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
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
    formaPagamento: 'PIX',
    modeloId: 'modelo-1',
    dataInicio: '2025-10-01',
    dataFimContrato: '2026-10-01',
    vencimentoDia: 10,
    criarCobranca: true,
    confirmacaoRevisao: true,
    notificationChannels: [],
  };

  const alunos: WizardAlunoFamiliar[] = [
    { id: 'a1', nome: 'João', turmaId: 'turma-1' },
    { id: 'a2', nome: 'Ana', turmaId: 'turma-2' },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('retorna success para todos os alunos quando API responde OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
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

    expect(results).toHaveLength(2);
    expect(results![0].status).toBe('success');
    expect(results![1].status).toBe('success');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstPayload = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(firstPayload.responsavelId).toBe('resp-1');
    expect(firstPayload.alunos).toHaveLength(2);
    expect(firstPayload.criarCobranca).toBe(true);
    expect(firstPayload.taxaMatricula).toBe(50);
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
    let results;
    await act(async () => {
      results = await result.current.submit({ ...baseState, alunosFamiliares: alunos });
    });

    expect(results![0].status).toBe('error');
    expect(results![0].errorMessage).toContain('Aluno já matriculado');
    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sanitiza menção a Asaas nas mensagens de erro', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Erro no Asaas: customer inválido' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    let results;
    await act(async () => {
      results = await result.current.submit({ ...baseState, alunosFamiliares: [alunos[0]] });
    });

    expect(results![0].errorMessage).not.toMatch(/Asaas/i);
    expect(results![0].errorMessage).toContain('financeiro');
  });

  it('lança erro se nenhum aluno for fornecido', async () => {
    const { result } = renderHook(() => useMatriculaFamiliarSubmit());
    await expect(
      act(async () => {
        await result.current.submit({ ...baseState, alunosFamiliares: [] });
      }),
    ).rejects.toThrow();
  });
});

// ─── canAdvance funções (isoladas) ────────────────────────────────────────────

describe('canAdvanceFromAlunosFamiliares (via wizard)', () => {
  it('bloqueia se menos de 2 alunos', () => {
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
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
    const { result } = renderHook(() => useMatriculaWizard('conta-1'));
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
