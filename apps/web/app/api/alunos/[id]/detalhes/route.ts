import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAsaasNotificationPreferences } from '@alusa/lib/services/integracoes/asaas-notifications.service';
import { prisma } from '@/lib/prisma';
import { deriveCustomerNotificationChannelDefaults } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessionUser = {
  id?: string | null;
  contaId?: string | null;
};

async function loadAuthOptions() {
  const { authOptions } = await import('@/lib/auth-options');
  return authOptions;
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && 'toNumber' in value) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePreference(preference: {
  event: string;
  scheduleOffset: number;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
}) {
  return {
    event: preference.event,
    scheduleOffset: preference.scheduleOffset,
    enabled: preference.enabled,
    emailEnabledForProvider: preference.emailEnabledForProvider,
    smsEnabledForProvider: preference.smsEnabledForProvider,
    emailEnabledForCustomer: preference.emailEnabledForCustomer,
    smsEnabledForCustomer: preference.smsEnabledForCustomer,
    whatsappEnabledForCustomer: preference.whatsappEnabledForCustomer,
    phoneCallEnabledForCustomer: preference.phoneCallEnabledForCustomer,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(await loadAuthOptions());
    const user = (session as { user?: SessionUser } | null)?.user;

    if (!user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const aluno = await prisma.aluno.findFirst({
      where: { id: params.id, contaId: user.contaId },
      include: {
        responsaveis: {
          include: { responsavel: true },
          orderBy: { id: 'asc' },
        },
        matriculas: {
          orderBy: { createdAt: 'desc' },
          include: {
            responsavelFinanceiro: true,
            plano: true,
            combo: true,
            turma: { include: { modalidade: true } },
            matriculaTurmas: {
              include: { turma: { include: { modalidade: true } } },
              orderBy: { createdAt: 'asc' },
            },
            contratoAtual: true,
            contratos: { orderBy: { createdAt: 'desc' } },
            cobrancas: {
              orderBy: { vencimento: 'desc' },
              include: {
                pagamentos: { orderBy: { createdAt: 'desc' } },
              },
            },
            subscriptions: { orderBy: { createdAt: 'desc' } },
            installmentPlans: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!aluno) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Aluno não encontrado');
    }

    const alunoCustomer = await prisma.customer.findFirst({
      where: {
        contaId: user.contaId,
        payerType: 'ALUNO',
        payerId: aluno.id,
      },
      include: {
        charges: {
          where: { cobrancaId: null },
          orderBy: { dueDate: 'desc' },
        },
        standaloneInstallmentPlans: { orderBy: { createdAt: 'desc' } },
        standaloneSubscriptions: { orderBy: { createdAt: 'desc' } },
      },
    });

    const preferences = await getAsaasNotificationPreferences(user.contaId);
    const notificationPreferences = preferences.map(sanitizePreference);

    const responsaveis = aluno.responsaveis.map((vinculo) => ({
      id: vinculo.responsavel.id,
      vinculoId: vinculo.id,
      tipoVinculo: vinculo.tipoVinculo,
      nome: vinculo.responsavel.nome,
      cpf: vinculo.responsavel.cpf,
      email: vinculo.responsavel.email,
      telefone: vinculo.responsavel.telefone,
      financeiro: vinculo.responsavel.financeiro,
      asaasCustomerId: vinculo.responsavel.asaasCustomerId,
      endereco: {
        cep: vinculo.responsavel.enderecoCep,
        logradouro: vinculo.responsavel.enderecoLogradouro,
        numero: vinculo.responsavel.enderecoNumero,
        complemento: vinculo.responsavel.enderecoComplemento,
        bairro: vinculo.responsavel.enderecoBairro,
        cidade: vinculo.responsavel.enderecoCidade,
        uf: vinculo.responsavel.enderecoUf,
      },
    }));

    const responsavelPrincipal =
      responsaveis.find((responsavel) => responsavel.financeiro) ??
      responsaveis.find((responsavel) =>
        ['FINANCEIRO', 'PRINCIPAL'].includes(responsavel.tipoVinculo),
      ) ??
      responsaveis[0] ??
      null;

    const matriculas = aluno.matriculas.map((matricula) => ({
      id: matricula.id,
      status: matricula.status,
      statusFinanceiro: matricula.statusFinanceiro,
      statusContrato: matricula.statusContrato,
      dataInicio: toIso(matricula.dataInicio),
      dataFim: toIso(matricula.dataFim),
      dataFimContrato: toIso(matricula.dataFimContrato),
      vencimentoDia: matricula.vencimentoDia,
      taxaMatricula: toNumber(matricula.taxaMatricula),
      taxaStatus: matricula.taxaStatus,
      taxaIsenta: matricula.taxaIsenta,
      formaPagamento: matricula.formaPagamento,
      formaPagamentoTaxa: matricula.formaPagamentoTaxa,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
      createdAt: toIso(matricula.createdAt),
      updatedAt: toIso(matricula.updatedAt),
      plano: matricula.plano
        ? {
            id: matricula.plano.id,
            nome: matricula.plano.nome,
            valor: toNumber(matricula.plano.valor),
            periodicidade: matricula.plano.periodicidade,
          }
        : null,
      combo: matricula.combo
        ? {
            id: matricula.combo.id,
            nome: matricula.combo.nome,
            valor: toNumber(matricula.combo.valor),
            periodicidade: matricula.combo.periodicidade,
          }
        : null,
      turma: matricula.turma
        ? {
            id: matricula.turma.id,
            nome: matricula.turma.nome,
            modalidade: matricula.turma.modalidade?.nome ?? null,
          }
        : null,
      turmas: matricula.matriculaTurmas.map((item) => ({
        id: item.turma.id,
        nome: item.turma.nome,
        modalidade: item.turma.modalidade?.nome ?? null,
      })),
      responsavelFinanceiro: matricula.responsavelFinanceiro
        ? {
            id: matricula.responsavelFinanceiro.id,
            nome: matricula.responsavelFinanceiro.nome,
            cpf: matricula.responsavelFinanceiro.cpf,
            email: matricula.responsavelFinanceiro.email,
            telefone: matricula.responsavelFinanceiro.telefone,
            asaasCustomerId: matricula.responsavelFinanceiro.asaasCustomerId,
          }
        : null,
      contratoAtual: matricula.contratoAtual
        ? {
            id: matricula.contratoAtual.id,
            status: matricula.contratoAtual.status,
            assinadoEm: toIso(matricula.contratoAtual.assinadoEm),
            createdAt: toIso(matricula.contratoAtual.createdAt),
          }
        : null,
      contratos: matricula.contratos.map((contrato) => ({
        id: contrato.id,
        status: contrato.status,
        assinadoEm: toIso(contrato.assinadoEm),
        createdAt: toIso(contrato.createdAt),
      })),
    }));

    const cobrancasAcademicas = aluno.matriculas.flatMap((matricula) =>
      matricula.cobrancas.map((cobranca) => ({
        id: cobranca.id,
        source: 'ACADEMICA' as const,
        matriculaId: matricula.id,
        tipo: cobranca.tipo,
        descricao: cobranca.descricao,
        status: cobranca.status,
        valor: toNumber(cobranca.valor),
        valorFinal: toNumber(cobranca.valorFinal),
        vencimento: toIso(cobranca.vencimento),
        dataPagamento: toIso(cobranca.dataPagamento),
        formaPagamento: cobranca.formaPagamento,
        asaasPaymentId: cobranca.asaasPaymentId,
        planoNome: matricula.plano?.nome ?? matricula.combo?.nome ?? null,
        createdAt: toIso(cobranca.createdAt),
        pagamentos: cobranca.pagamentos.map((pagamento) => ({
          id: pagamento.id,
          dataPagamento: toIso(pagamento.dataPagamento),
          formaPagamento: pagamento.formaPagamento,
          valorPago: toNumber(pagamento.valorPago),
          status: pagamento.status,
          comprovante: pagamento.comprovante,
        })),
      })),
    );

    const cobrancasAvulsas = (alunoCustomer?.charges ?? []).map((charge) => ({
      id: charge.id,
      source: 'AVULSA' as const,
      matriculaId: null,
      tipo: charge.standaloneInstallmentPlanId
        ? 'PARCELADA'
        : charge.standaloneSubscriptionId
          ? 'RECORRENTE'
          : 'AVULSA',
      descricao: charge.description,
      status: charge.status,
      valor: toNumber(charge.value),
      valorFinal: toNumber(charge.value),
      vencimento: toIso(charge.dueDate),
      dataPagamento: null,
      formaPagamento: charge.billingType,
      asaasPaymentId: charge.asaasPaymentId,
      planoNome: null,
      createdAt: toIso(charge.createdAt),
      pagamentos: [],
    }));

    const cobrancas = [...cobrancasAcademicas, ...cobrancasAvulsas].sort((a, b) => {
      const aTime = a.vencimento ? new Date(a.vencimento).getTime() : 0;
      const bTime = b.vencimento ? new Date(b.vencimento).getTime() : 0;
      return bTime - aTime;
    });

    const assinaturasAcademicas = aluno.matriculas.flatMap((matricula) =>
      matricula.subscriptions.map((subscription) => ({
        id: subscription.id,
        source: 'ACADEMICA' as const,
        matriculaId: matricula.id,
        status: subscription.status,
        asaasSubscriptionId: subscription.asaasSubscriptionId,
        externalReference: subscription.externalReference,
        planoNome: matricula.plano?.nome ?? matricula.combo?.nome ?? null,
        createdAt: toIso(subscription.createdAt),
        updatedAt: toIso(subscription.updatedAt),
      })),
    );

    const assinaturasLegadas = aluno.matriculas
      .filter(
        (matricula) =>
          matricula.asaasSubscriptionId &&
          !matricula.subscriptions.some(
            (subscription) => subscription.asaasSubscriptionId === matricula.asaasSubscriptionId,
          ),
      )
      .map((matricula) => ({
        id: matricula.asaasSubscriptionId!,
        source: 'MATRICULA' as const,
        matriculaId: matricula.id,
        status: matricula.status,
        asaasSubscriptionId: matricula.asaasSubscriptionId,
        externalReference: null,
        planoNome: matricula.plano?.nome ?? matricula.combo?.nome ?? null,
        createdAt: toIso(matricula.createdAt),
        updatedAt: toIso(matricula.updatedAt),
      }));

    const assinaturasAvulsas = (alunoCustomer?.standaloneSubscriptions ?? []).map((subscription) => ({
      id: subscription.id,
      source: 'AVULSA' as const,
      matriculaId: null,
      status: subscription.status,
      asaasSubscriptionId: subscription.asaasSubscriptionId,
      externalReference: subscription.externalReference,
      planoNome: subscription.description,
      createdAt: toIso(subscription.createdAt),
      updatedAt: toIso(subscription.updatedAt),
    }));

    const parcelamentosAcademicos = aluno.matriculas.flatMap((matricula) =>
      matricula.installmentPlans.map((plan) => ({
        id: plan.id,
        source: 'ACADEMICO' as const,
        matriculaId: matricula.id,
        status: plan.status,
        asaasInstallmentId: plan.asaasInstallmentId,
        externalReference: plan.externalReference,
        installmentCount: plan.installmentCount,
        billingType: plan.billingType,
        value: toNumber(plan.value),
        firstDueDate: toIso(plan.firstDueDate),
        planoNome: matricula.plano?.nome ?? matricula.combo?.nome ?? null,
        createdAt: toIso(plan.createdAt),
        updatedAt: toIso(plan.updatedAt),
      })),
    );

    const parcelamentosAvulsos = (alunoCustomer?.standaloneInstallmentPlans ?? []).map((plan) => ({
      id: plan.id,
      source: 'AVULSO' as const,
      matriculaId: null,
      status: plan.status,
      asaasInstallmentId: plan.asaasInstallmentId,
      externalReference: plan.externalReference,
      installmentCount: plan.installmentCount,
      billingType: plan.billingType,
      value: toNumber(plan.value),
      firstDueDate: toIso(plan.firstDueDate),
      planoNome: null,
      createdAt: toIso(plan.createdAt),
      updatedAt: toIso(plan.updatedAt),
    }));

    const responsavelFinanceiroCustomerId =
      matriculas.find((matricula) => matricula.responsavelFinanceiro?.asaasCustomerId)
        ?.responsavelFinanceiro?.asaasCustomerId ?? null;
    const notificationCustomerId =
      aluno.asaasCustomerId ??
      alunoCustomer?.asaasCustomerId ??
      responsavelFinanceiroCustomerId ??
      responsavelPrincipal?.asaasCustomerId ??
      null;

    const response = {
      aluno: {
        id: aluno.id,
        nome: aluno.nome,
        nomeSocial: aluno.nomeSocial,
        dataNasc: toIso(aluno.dataNasc),
        cpf: aluno.cpf,
        email: aluno.email,
        telefone: aluno.telefone,
        foto: aluno.foto,
        status: aluno.status,
        enderecoCep: aluno.enderecoCep,
        enderecoLogradouro: aluno.enderecoLogradouro,
        enderecoNumero: aluno.enderecoNumero,
        enderecoComplemento: aluno.enderecoComplemento,
        enderecoBairro: aluno.enderecoBairro,
        enderecoCidade: aluno.enderecoCidade,
        enderecoUf: aluno.enderecoUf,
        observacao: aluno.observacao,
        genero: aluno.genero,
        modalidadePrincipal: aluno.modalidadePrincipal,
        nivel: aluno.nivel,
        alergias: aluno.alergias,
        restricoesMedicas: aluno.restricoesMedicas,
        contatoEmergenciaNome: aluno.contatoEmergenciaNome,
        contatoEmergenciaTelefone: aluno.contatoEmergenciaTelefone,
        origemCadastro: aluno.origemCadastro,
        bolsaDescontoPercent: toNumber(aluno.bolsaDescontoPercent),
        isentoTaxaMatricula: aluno.isentoTaxaMatricula,
        consentimentoImagem: aluno.consentimentoImagem,
        dataConsentimentoImagem: toIso(aluno.dataConsentimentoImagem),
        consentimentoComunicacoes: aluno.consentimentoComunicacoes,
        tamanhoCamiseta: aluno.tamanhoCamiseta,
        tamanhoCalcado: aluno.tamanhoCalcado,
        codigoInterno: aluno.codigoInterno,
        tags: aluno.tags,
        asaasId: aluno.asaasId,
        asaasCustomerId: aluno.asaasCustomerId ?? alunoCustomer?.asaasCustomerId ?? null,
        asaasCustomerExternalReference:
          aluno.asaasCustomerExternalReference ?? alunoCustomer?.externalReference ?? null,
        dataInativacao: toIso(aluno.dataInativacao),
        motivoInativacao: aluno.motivoInativacao,
        createdAt: toIso(aluno.createdAt),
        updatedAt: toIso(aluno.updatedAt),
        responsaveis,
        responsavelPrincipal,
        matriculas,
        cobrancas,
        assinaturas: [...assinaturasAcademicas, ...assinaturasLegadas, ...assinaturasAvulsas],
        parcelamentos: [...parcelamentosAcademicos, ...parcelamentosAvulsos],
        notificacoes: {
          asaasCustomerId: notificationCustomerId,
          preferences: notificationPreferences,
          customerChannelDefaults:
            deriveCustomerNotificationChannelDefaults(notificationPreferences),
        },
        resumo: {
          matriculas: matriculas.length,
          matriculasAtivas: matriculas.filter((matricula) =>
            ['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'].includes(
              matricula.status,
            ),
          ).length,
          cobrancas: cobrancas.length,
          cobrancasPendentes: cobrancas.filter((cobranca) =>
            ['PENDENTE', 'A_VENCER', 'ATRASADO', 'CREATED', 'OPEN', 'OVERDUE'].includes(
              cobranca.status,
            ),
          ).length,
          assinaturas:
            assinaturasAcademicas.length + assinaturasLegadas.length + assinaturasAvulsas.length,
          parcelamentos: parcelamentosAcademicos.length + parcelamentosAvulsos.length,
        },
      },
    };

    return NextResponse.json(response, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[alunos/detalhes][GET]', error);
    return jsonError(500, 'ERRO_INTERNO', (error as Error).message);
  }
}
