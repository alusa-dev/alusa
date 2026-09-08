import { describe, expect, it } from 'vitest';

import { createMatriculaFamiliarInputSchema } from './family-enrollment.schema';
import {
  classifyFamilyEnrollmentOperationCollision,
  type FamilyEnrollmentOperationCollisionRecord,
} from './create-family-enrollment.use-case';

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

function operation(
  overrides: Partial<FamilyEnrollmentOperationCollisionRecord> = {},
): FamilyEnrollmentOperationCollisionRecord {
  return {
    id: 'operation-1',
    familyGroupId: 'family-1',
    status: 'PROCESSING',
    previewHash: hash,
    sourceVersion: hash,
    strategy: 'CREATE_NEW_FAMILY',
    requestFingerprint: 'request-1',
    result: null,
    ...overrides,
  };
}

function classify(overrides: {
  sameRequest?: FamilyEnrollmentOperationCollisionRecord | null;
  activeFamilyOperation?: FamilyEnrollmentOperationCollisionRecord | null;
} = {}) {
  return classifyFamilyEnrollmentOperationCollision({
    sameRequest: overrides.sameRequest ?? null,
    activeFamilyOperation: overrides.activeFamilyOperation ?? null,
    requestFingerprint: 'request-1',
    previewHash: hash,
    sourceVersion: hash,
    strategy: 'CREATE_NEW_FAMILY',
  });
}

describe('classifyFamilyEnrollmentOperationCollision', () => {
  it('permite uma nova intenção após falha definitiva', () => {
    expect(classify({ sameRequest: operation({ status: 'FAILED' }) }).kind).toBe('NEW_INTENT_REQUIRED');
  });

  it('mantém resultado remoto incerto como bloqueio de reconciliação', () => {
    expect(
      classify({ sameRequest: operation({ status: 'REQUIRES_RECONCILIATION' }) }).kind,
    ).toBe('REQUIRES_RECONCILIATION');
  });

  it('bloqueia uma operação pendente sem tratar o estado como replay vazio', () => {
    expect(classify({ sameRequest: operation({ status: 'PENDING' }) }).kind).toBe('IN_PROGRESS');
  });

  it('reconhece replay da mesma intenção concluída', () => {
    expect(
      classify({ sameRequest: operation({ status: 'COMPLETED', result: { familyId: 'family-1' } }) }).kind,
    ).toBe('REPLAY');
  });

  it('rejeita a reutilização da mesma chave com payload diferente', () => {
    expect(
      classify({ sameRequest: operation({ requestFingerprint: 'different-request' }) }).kind,
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('trata outra operação ativa da mesma família como concorrência', () => {
    expect(
      classify({
        activeFamilyOperation: operation({ requestFingerprint: 'different-request' }),
      }).kind,
    ).toBe('IN_PROGRESS');
  });
});
