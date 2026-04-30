import { describe, expect, it } from 'vitest';

import { mapListRematriculasResultToDTO } from '@/features/cadastro/rematriculas/mappers';

describe('Rematrículas DTO', () => {
  it('aceita listagem com campos financeiros nulos explícitos', () => {
    const result = mapListRematriculasResultToDTO({
      referencia: '2026-03-10T00:00:00.000Z',
      ate: '2026-05-09T00:00:00.000Z',
      total: 1,
      itens: [
        {
          id: 'mat-1',
          status: 'ATIVA',
          statusContrato: 'ATIVO',
          dataInicio: '2026-01-10T00:00:00.000Z',
          dataFimContrato: '2026-04-10T00:00:00.000Z',
          diasRestantes: 31,
          contratoExpirado: false,
          podeRenovar: false,
          eligibilityStatus: 'ELEGIVEL',
          aluno: {
            id: 'aluno-1',
            nome: 'Aluno 1',
            cpf: null,
            foto: null,
          },
          plano: {
            id: 'plano-1',
            nome: 'Plano Integral',
          },
          turma: {
            id: 'turma-1',
            nome: 'Turma A',
            diasSemana: ['SEGUNDA', 'QUARTA'],
            horaInicio: '08:00',
            horaFim: '09:00',
          },
          combo: null,
          financeiro: {
            pendencias: 2,
            cobrancasEmAberto: 2,
            cobrancasAtrasadas: 1,
            financialStatus: 'ATRASADO',
            rematriculaActionStatus: 'REQUER_OVERRIDE',
            blockReason: 'COBRANCA_ATRASADA',
            actionMessage: 'Existe cobrança atrasada vinculada à matrícula anterior.',
            canCurrentUserOverride: true,
            requiresOverrideReason: true,
            shouldBlockNewFinancialCycle: false,
            formaPagamento: null,
            formaPagamentoTaxa: 'BOLETO',
            vencimentoDia: 5,
            taxaMatricula: 150,
            taxaIsenta: false,
            taxaJustificativa: null,
            multaPercentual: null,
            jurosMensal: null,
            descontoAntecipado: null,
            prazoDesconto: null,
            diasTolerancia: null,
            descontos: [],
          },
        },
      ],
    });

    expect(result.total).toBe(1);
    expect(result.itens[0]?.aluno.cpf).toBeNull();
    expect(result.itens[0]?.turma?.diasSemana).toEqual(['SEGUNDA', 'QUARTA']);
    expect(result.itens[0]?.financeiro.formaPagamento).toBeNull();
    expect(result.itens[0]?.financeiro.rematriculaActionStatus).toBe('REQUER_OVERRIDE');
    expect(result.itens[0]?.financeiro.descontos).toEqual([]);
  });
});