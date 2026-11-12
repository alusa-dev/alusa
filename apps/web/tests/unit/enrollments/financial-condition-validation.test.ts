import { describe, expect, it, vi } from 'vitest';
import { createMatriculaInputDTOSchema } from '@/features/enrollments/dtos';
import { createMatriculaFamiliarInputSchema } from '@/src/server/enrollments/family-enrollment.schema';
import { validarCondicaoFinanceiraMatricula, resolveEnrollmentMonthlyAmount, type CriarMatriculaInput, buildCriarMatriculaResultFromExisting } from '@/src/server/enrollments/enrollment.service';
import { prisma } from '@/src/prisma';

const individualBase = {
  alunoId: 'aluno-1',
  modeloId: 'modelo-1',
  dataFimContrato: '2027-12-31',
  previewHash: 'a'.repeat(64),
  sourceVersion: 'b'.repeat(64),
  previewExpiresAt: '2027-01-01T00:00:00.000Z',
  billingStrategy: { kind: 'SEPARATE' as const },
};

const familyBase = {
  responsavelId: 'responsavel-1',
  modoTurmas: 'TURMAS' as const,
  planoId: 'plano-1',
  alunos: [{ alunoId: 'aluno-1', turmaId: 'turma-1' }],
  vencimentoDia: 5,
  formaPagamento: 'PIX' as const,
  dataInicio: '2027-01-01',
  dataFimContrato: '2027-12-31',
  modeloId: 'modelo-1',
  previewHash: 'a'.repeat(64),
  sourceVersion: 'b'.repeat(64),
  previewExpiresAt: '2027-01-01T00:00:00.000Z',
  uiRequestId: 'request-1',
};

describe('validação da condição financeira da matrícula', () => {
  it.each(['2026-12-31', '2028-01-01'])('rejects benefit validity outside the contract in both APIs: %s', (condicaoValidaAte) => {
    const condition = { condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo: 'Bolsa', condicaoValidaAte };
    expect(createMatriculaInputDTOSchema.safeParse({ ...individualBase, dataInicio: '2027-01-01', ...condition }).success).toBe(false);
    expect(createMatriculaFamiliarInputSchema.safeParse({ ...familyBase, ...condition }).success).toBe(false);
    expect(() => validarCondicaoFinanceiraMatricula({
      condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo: 'Bolsa', condicaoValidaAte: new Date(condicaoValidaAte),
      dataInicio: new Date('2027-01-01'), dataFimContrato: new Date('2027-12-31'),
    })).toThrow();
  });

  it('rejects a forged amount before selecting the subscription path and scopes the catalog by tenant', async () => {
    const catalog = { plano: { findFirst: vi.fn().mockResolvedValue({ valor: 150 }) }, combo: { findFirst: vi.fn() } };
    const input: CriarMatriculaInput = {
      contaId: 'conta-1', alunoId: 'aluno-1', planoId: 'plano-1', dataInicio: new Date('2027-01-01'), dataFimContrato: new Date('2027-12-31'),
      vencimentoDia: 5, taxaMatricula: 0, taxaIsenta: true, pagarTaxaAgora: false, gerarCobrancaTaxa: false, criarCobranca: true,
      createdById: 'user-1', modeloId: 'modelo-1', condicaoFinanceira: 'NORMAL', valorMensalidadeOverride: 0,
    };
    await expect(resolveEnrollmentMonthlyAmount(input, catalog as never)).rejects.toThrow('diverge');
    expect(catalog.plano.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'plano-1', contaId: 'conta-1' } }));
    await expect(resolveEnrollmentMonthlyAmount({ ...input, condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo: 'Bolsa', condicaoValidaAte: input.dataFimContrato }, catalog as never)).resolves.toBe(0);
    await expect(resolveEnrollmentMonthlyAmount({ ...input, condicaoFinanceira: 'BOLSA_PARCIAL', condicaoPercentual: 50, condicaoMotivo: 'Bolsa', condicaoValidaAte: input.dataFimContrato, valorMensalidadeOverride: 75 }, catalog as never)).resolves.toBe(75);
  });

  it.each(['BOLSA_PARCIAL', 'ISENCAO_INTEGRAL'] as const)('replays the agreed price for %s instead of restoring the gross plan', async (condicaoFinanceira) => {
    const result = await buildCriarMatriculaResultFromExisting({
      condicaoFinanceira, condicaoPercentual: condicaoFinanceira === 'BOLSA_PARCIAL' ? 50 : null,
      plano: { valor: 150 }, combo: null, descontos: [], cobrancas: [], taxaMatricula: 0,
      dataInicio: new Date('2027-01-01'), vencimentoDia: 5,
    } as never);
    expect(result.preco.plano).toBe(150);
    expect(result.preco.planoLiquido).toBe(condicaoFinanceira === 'BOLSA_PARCIAL' ? 75 : 0);
  });

  it('rejeita bolsa parcial sem percentual ou com percentual fora do intervalo', () => {
    for (const condicaoPercentual of [undefined, 0, 100]) {
      const result = createMatriculaInputDTOSchema.safeParse({
        ...individualBase,
        condicaoFinanceira: 'BOLSA_PARCIAL',
        condicaoPercentual,
        condicaoMotivo: 'Desempenho acadêmico',
        condicaoValidaAte: '2027-06-30',
      });
      expect(result.success).toBe(false);
    }
  });

  it('exige motivo e validade no input individual e familiar', () => {
    const individual = createMatriculaInputDTOSchema.safeParse({
      ...individualBase,
      condicaoFinanceira: 'ISENCAO_INTEGRAL',
    });
    const family = createMatriculaFamiliarInputSchema.safeParse({
      ...familyBase,
      condicaoFinanceira: 'ISENCAO_INTEGRAL',
    });
    expect(individual.success).toBe(false);
    expect(family.success).toBe(false);
  });

  it('aceita isenção integral com justificativa e validade, sem percentual', () => {
    expect(createMatriculaInputDTOSchema.safeParse({
      ...individualBase,
      condicaoFinanceira: 'ISENCAO_INTEGRAL',
      condicaoMotivo: 'Bolsa institucional',
      condicaoValidaAte: '2027-06-30',
    }).success).toBe(true);
  });

  it('rejeita condição inválida também no preflight de servidor', () => {
    expect(() => validarCondicaoFinanceiraMatricula({
      condicaoFinanceira: 'BOLSA_PARCIAL',
      condicaoMotivo: 'Desempenho acadêmico',
      condicaoValidaAte: new Date('2027-06-30T00:00:00.000Z'),
      condicaoPercentual: null,
    })).toThrow('Informe motivo, validade e, para bolsa parcial, um percentual entre 0 e 100.');
  });

  it('mantém o CHECK de integridade no banco instalado pela migration', async () => {
    const constraints = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Matricula"'::regclass
        AND conname = 'Matricula_condicao_financeira_details_check'
        AND convalidated = true
    `;

    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.definition).toContain('condicaoValidaAte');
    expect(constraints[0]?.definition).toContain('ISENCAO_INTEGRAL');
  });
});
