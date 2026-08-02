import { describe, expect, it } from 'vitest';

import { createMatriculaFamiliarInputSchema } from './family-enrollment.schema';

const hash = 'a'.repeat(64);

function validRequest() {
  return {
    responsavelId: 'responsavel-1',
    modoTurmas: 'TURMAS' as const,
    planoId: 'plano-familiar',
    alunos: [{ itemId: 'item-1', alunoId: 'aluno-1', turmaId: 'turma-1' }],
    vencimentoDia: 10,
    formaPagamento: 'PIX' as const,
    dataInicio: '2026-08-01',
    dataFimContrato: '2027-07-31',
    modeloId: 'modelo-1',
    previewHash: hash,
    sourceVersion: hash,
    previewExpiresAt: '2026-08-01T12:00:00.000Z',
    uiRequestId: 'family-enrollment-request-1',
  };
}

describe('createMatriculaFamiliarInputSchema', () => {
  it('aceita uma única nova matrícula no agrupamento financeiro', () => {
    expect(createMatriculaFamiliarInputSchema.safeParse(validRequest()).success).toBe(true);
  });

  it('aceita o mesmo aluno em turmas distintas no mesmo lote', () => {
    const request = validRequest();
    request.alunos.push({ itemId: 'item-2', alunoId: 'aluno-1', turmaId: 'turma-2' });

    expect(createMatriculaFamiliarInputSchema.safeParse(request).success).toBe(true);
  });

  it('rejeita um agrupamento sem nenhuma matrícula', () => {
    const request = validRequest();
    request.alunos = [];

    expect(createMatriculaFamiliarInputSchema.safeParse(request).success).toBe(false);
  });
});
