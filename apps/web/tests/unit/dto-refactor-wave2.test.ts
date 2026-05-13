import { describe, expect, it } from 'vitest';

import {
  userProfileWithSchoolDTOSchema,
  userSchoolAddressDTOSchema,
} from '@/features/users/dtos';
import { mapContaFormaPagamentoResultToDTO } from '@/features/conta/mappers';
import { mapAlunoListItemToDTO } from '@/features/cadastro/alunos/mappers';
import { mapProfessorRecordToDTO } from '@/features/cadastro/professores/mappers';
import { mapDashboardMetricsResultToDTO } from '@/features/dashboard/mappers';
import { mapCreateRematriculaResultToDTO } from '@/features/cadastro/rematriculas/mappers';
import {
  mapFinanceiroIndicadoresResultToDTO,
  mapFinanceiroLancamentoRecordToDTO,
  mapFinanceiroPagamentoAlunoHistoricoResultToDTO,
  mapFinanceiroKpisResultToDTO,
} from '@/features/financeiro/mappers';
import {
  mapCobrancaActionResultToDTO,
  mapFinanceiroCobrancaListItemToDTO,
} from '@/features/financeiro/cobrancas/mappers';

describe('DTO Refactor Wave 2', () => {
  it('parses user profile with school address', () => {
    const profile = userProfileWithSchoolDTOSchema.parse({
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      telefone: null,
      foto: null,
      bio: null,
      locale: 'pt-BR',
      theme: 'system',
      notifications: {
        emailProduct: true,
        emailSecurity: true,
        emailMarketing: false,
        whatsapp: false,
        sms: false,
      },
      school: {
        id: 'conta-1',
        name: 'Alusa',
        cpfCnpj: '00000000000191',
        status: 'ATIVO',
        ownerUserId: 'user-1',
        timezone: 'America/Manaus',
        address: userSchoolAddressDTOSchema.parse({
          street: 'Rua A',
          number: '10',
          district: 'Centro',
          city: 'Manaus',
          state: 'AM',
          cep: '69000000',
        }),
      },
    });

    expect(profile.school?.address.city).toBe('Manaus');
  });

  it('maps conta forma de pagamento result', () => {
    const result = mapContaFormaPagamentoResultToDTO({
      responsavel: {
        id: 'resp-1',
        nome: 'Maria',
        email: 'maria@example.com',
      },
      assinaturas: [
        {
          id: 'mat-1',
          asaasSubscriptionId: 'sub-1',
          aluno: 'Aluno',
          cpf: '123',
          plano: 'Mensal',
          status: 'ATIVA',
          formaPagamento: 'BOLETO',
          proximaCobranca: {
            id: 'cob-1',
            status: 'PENDENTE',
            vencimento: new Date('2026-03-10T00:00:00Z'),
            valor: 100,
          },
        },
      ],
    });

    expect(result.assinaturas[0]?.proximaCobranca?.vencimento).toContain('2026-03-10');
  });

  it('maps aluno and professor summaries', () => {
    const aluno = mapAlunoListItemToDTO({
      id: 'aluno-1',
      nome: 'Aluno',
      email: null,
      telefone: null,
      status: 'ATIVO',
      foto: null,
      cpf: null,
      bolsaDescontoPercent: '10',
      dataConsentimentoImagem: new Date('2026-03-01T00:00:00Z'),
    });
    const professor = mapProfessorRecordToDTO({
      id: 'prof-1',
      nome: 'Professor',
      email: 'prof@example.com',
      telefoneCel: '999999999',
      status: 'ATIVO',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-02T00:00:00Z'),
    });

    expect(aluno.bolsaDescontoPercent).toBe(10);
    expect(professor.updatedAt).toContain('2026-03-02');
  });

  it('maps dashboard and financeiro aggregates', () => {
    const dashboard = mapDashboardMetricsResultToDTO({
      success: true,
      data: {
        totalAlunos: 1,
        alunosAtivos: 1,
        turmasAtivas: 2,
        aulasHoje: 3,
        pendencias: 1,
        aniversariantesDoMesAtivos: 1,
        totalMatriculas: 1,
        matriculasAtivas: 1,
        cobrancasPendentes: 1,
        cobrancasVencidas: 0,
        receitaMes: 100,
        aguardandoPagamentoProximos30Dias: 80,
        taxaMatriculaRecebidaAno: 50,
        receitaTotal: 200,
        proximosVencimentos: 1,
        taxaInadimplencia: 0,
        receitaSemanal: [1, 2, 3, 4, 5, 6, 7],
        matriculasNovasSemanal: [0, 0, 0, 0, 0, 0, 1],
        matriculasCanceladasSemanal: [0, 0, 0, 0, 0, 0, 0],
        ultimasCobrancas: [],
        alunosRecentes: [],
        aniversariantesDoMes: [
          {
            id: 'al_1',
            nome: 'Aluno Teste',
            foto: null,
            dia: 12,
            mes: 3,
            dataNascimento: '2010-03-12T00:00:00.000Z',
          },
        ],
      },
    });
    const indicadores = mapFinanceiroIndicadoresResultToDTO({
      data: {
        cobrancas: {
          pendentes: 1,
          pagas: 2,
          atrasadas: 0,
          valorPendentes: 50,
          valorPagos: 100,
        },
      },
    });
    const kpis = mapFinanceiroKpisResultToDTO({
      data: {
        recebidas: { valorBruto: 100, valorLiquido: 90, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        recebidasEmDinheiro: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        confirmadas: { valorBruto: 10, valorLiquido: 10, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        aguardandoPagamento: { valorBruto: 20, valorLiquido: 20, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        vencidas: { valorBruto: 5, valorLiquido: 5, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        receitaDoMes: {
          valorBruto: 100,
          valorLiquido: 90,
          quantidadeDeCobrancas: 1,
          quantidadeDeClientes: 1,
          periodo: { inicio: '2026-03-01T00:00:00.000Z', fim: '2026-04-01T00:00:00.000Z' },
        },
        resumo: {
          totalReceitaReal: 90,
          totalAReceber: 30,
          totalInadimplente: 5,
          taxaInadimplencia: 10,
        },
      },
    });

    expect(dashboard.data.totalAlunos).toBe(1);
    expect(indicadores.data.cobrancas.pagas).toBe(2);
    expect(kpis.data.resumo.totalReceitaReal).toBe(90);
  });

  it('maps rematricula and financeiro records', () => {
    const rematricula = mapCreateRematriculaResultToDTO({
      operationId: 'op-1',
      status: 'COMMITTED',
      matriculaId: 'mat-2',
      message: 'ok',
      novaMatricula: {
        id: 'mat-2',
        planoId: 'plano-1',
        turmaId: null,
        status: 'ATIVA',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        dataInicio: '2026-03-01T00:00:00.000Z',
        dataFimContrato: '2027-03-01T00:00:00.000Z',
        asaasSubscriptionId: null,
      },
      historicoContrato: {
        dataInicioAnterior: '2025-03-01T00:00:00.000Z',
        dataFimContratoAnterior: '2026-03-01T00:00:00.000Z',
        turmaIdAnterior: null,
        planoIdAnterior: 'plano-antigo',
      },
      primeiroVencimento: '2026-04-01T00:00:00.000Z',
      responsavelFinanceiro: null,
    });
    const lancamento = mapFinanceiroLancamentoRecordToDTO({
      id: 'lan-1',
      tipo: 'RECEITA',
      origem: 'MANUAL',
      status: 'RECEBIDO',
      valor: 100,
      descricao: 'Receita',
      dataEfetiva: new Date('2026-03-01T00:00:00Z'),
      dataPrevista: null,
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T00:00:00Z'),
    });
    const cobranca = mapFinanceiroCobrancaListItemToDTO({
      id: 'cob-1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
      status: 'PENDENTE',
      liquidacaoStatus: null,
      valor: 100,
      vencimento: new Date('2026-03-10T00:00:00Z'),
      aluno: { id: 'aluno-1', nome: 'Aluno' },
      matriculaId: 'mat-1',
      asaasPaymentId: null,
      atrasado: false,
      origin: 'ACADEMIC',
      description: 'Mensalidade',
      isGroup: false,
      groupType: null,
      installmentPlanId: null,
      installmentCount: null,
      installmentsPaid: null,
      installments: null,
    });

    expect(rematricula.novaMatricula.status).toBe('ATIVA');
    expect(lancamento.dataEfetiva).toContain('2026-03-01');
    expect(cobranca.origin).toBe('ACADEMIC');
  });

  it('maps cobranca action payloads', () => {
    const action = mapCobrancaActionResultToDTO({
      success: true,
      pending: true,
      message: 'Solicitação enviada',
      correlationId: 'corr-1',
      data: {
        cobrancaId: 'cob-1',
        paymentDateStr: '2026-03-12',
      },
    });

    expect(action.correlationId).toBe('corr-1');
    expect(action.data?.paymentDateStr).toBe('2026-03-12');
  });

  it('maps payment history by aluno', () => {
    const result = mapFinanceiroPagamentoAlunoHistoricoResultToDTO({
      success: true,
      data: {
        aluno: {
          id: 'aluno-1',
          nome: 'Aluno',
          email: 'aluno@example.com',
          telefone: '92999999999',
          cpf: '12345678900',
          foto: null,
        },
        pagamentos: [
          {
            id: 'pag-1',
            status: 'PAGO',
            valorPago: 100,
            dataPagamento: '2026-03-10T00:00:00.000Z',
            formaPagamento: 'PIX',
            comprovante: null,
            cobrancaId: 'cob-1',
            asaasPaymentId: 'pay-1',
            createdAt: '2026-03-10T00:00:00.000Z',
            cobranca: {
              id: 'cob-1',
              tipo: 'MENSALIDADE',
              status: 'PAGO',
              valor: 100,
              vencimento: '2026-03-10T00:00:00.000Z',
              descricao: 'Mensalidade março',
            },
          },
        ],
      },
    });

    expect(result.data.aluno.nome).toBe('Aluno');
    expect(result.data.pagamentos[0]?.cobranca.tipo).toBe('MENSALIDADE');
  });
});
