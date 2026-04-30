import { describe, expect, it } from 'vitest';
import {
  mapCreateMatriculaDTOToServiceInput,
  mapListMatriculasResultToDTO,
} from '@/features/cadastro/matriculas/mappers';

describe('matriculas DTO mappers', () => {
  it('normaliza payload de criação para input de serviço', () => {
    const payload = mapCreateMatriculaDTOToServiceInput({
      body: {
        alunoId: 'alu_1',
        planoId: 'plano_1',
        turmaId: 'turma_1',
        dataFimContrato: '2026-12-31',
        taxaMatricula: '149,90',
        taxaIsenta: 'false',
        criarCobranca: 'true',
        gerarCobrancaTaxa: 'true',
        pagarTaxaAgora: 'true',
        formaPagamento: 'cartao',
        formaPagamentoTaxa: 'pix',
      },
      contaId: 'conta_1',
      createdById: 'user_1',
    });

    expect(payload.taxaMatricula).toBe(149.9);
    expect(payload.formaPagamento).toBe('CARTAO_CREDITO');
    expect(payload.formaPagamentoTaxa).toBe('PIX');
    expect(payload.dataFimContrato).toBeInstanceOf(Date);
  });

  it('mapeia resultado de listagem para DTO padronizado', () => {
    const payload = mapListMatriculasResultToDTO({
      data: [
        {
          id: 'mat_1',
          status: 'ATIVA',
          statusFinanceiro: 'ADIMPLENTE',
          statusContrato: 'ATIVO',
          dataInicio: new Date('2026-01-01T12:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T12:00:00.000Z'),
          taxaMatricula: 100,
          taxaStatus: 'PAGO',
          taxaIsenta: false,
          vencimentoDia: 5,
          aluno: { id: 'alu_1', nome: 'João', cpf: '12345678901' },
          plano: { id: 'plano_1', nome: 'Mensal', valor: 200 },
          turma: {
            id: 'turma_1',
            nome: 'Turma A',
            diasSemana: ['SEG'],
            horaInicio: '08:00',
            horaFim: '09:00',
          },
          turmas: [],
          combo: null,
          cobrancas: [],
          contratos: [],
          responsavelFinanceiro: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    expect(payload.totalPages).toBe(1);
    expect(payload.matriculas[0]?.dataFimContrato).toBe('2026-12-31T12:00:00.000Z');
    expect(payload.data[0]?.plano?.valor).toBe(200);
  });
});
