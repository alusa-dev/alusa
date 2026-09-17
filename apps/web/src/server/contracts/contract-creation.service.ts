import { prisma } from '@/prisma/client';
import { PeriodicidadePlano, type Prisma } from '@prisma/client';
import { buildSubscriptionExternalReference, createSubscription } from '@alusa/finance';
import { calcularPrecoMatricula } from '@/src/server/matriculas/matricula.service';
import { materializeSubscriptionPaymentForCharge } from '@/src/server/matriculas/subscription-payment-materialization';
import { formatIsoDate, mapFormaPagamentoToBillingType, mapPeriodicidadeToCycle, resolveChargeableFirstDueDate } from '@/src/server/matriculas/recurring-billing';
import { issueEnrollmentContract } from './issue-enrollment-contract.service';

export async function getContractCreationContext(input: { contaId: string; matriculaId: string; contratoOrigemId?: string | null }) {
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: {
      id: true, alunoId: true, dataInicio: true, dataFimContrato: true, vencimentoDia: true, formaPagamento: true,
      descontoAntecipado: true, prazoDesconto: true, descontoTipo: true, jurosMensal: true, multaPercentual: true, multaTipo: true,
      asaasSubscriptionId: true, billingMode: true,
      aluno: {
        select: {
          id: true, contaId: true, nome: true, cpf: true, dataNasc: true, email: true, telefone: true,
          enderecoLogradouro: true, enderecoNumero: true, enderecoBairro: true, enderecoCidade: true, enderecoUf: true,
          responsaveis: {
            where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
            orderBy: { id: 'asc' }, take: 1,
            select: { tipoVinculo: true, responsavel: { select: { id: true, nome: true, cpf: true } } },
          },
        },
      },
      responsavelFinanceiro: { select: { nome: true, cpf: true, email: true, telefone: true, enderecoLogradouro: true, enderecoNumero: true, enderecoBairro: true, enderecoCidade: true, enderecoUf: true } },
      turma: { select: { nome: true } },
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
      combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
      descontos: { select: { desconto: { select: { tipo: true, valor: true } } } },
      cobrancas: { where: { tipo: 'MENSALIDADE' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!matricula) return null;
  const existingPendente = await prisma.contrato.findFirst({ where: { contaId: input.contaId, matriculaId: input.matriculaId, status: 'PENDENTE' }, select: { id: true } });
  const origem = input.contratoOrigemId ? await prisma.contrato.findFirst({ where: { id: input.contratoOrigemId, contaId: input.contaId }, select: { id: true, matriculaId: true, status: true } }) : null;
  return { matricula, existingPendente, origem };
}

export async function issueContractForTenant(input: {
  contaId: string; matriculaId: string; modeloId: string; contratoOrigemId?: string | null; actorId: string;
}) {
  return prisma.$transaction((tx) => issueEnrollmentContract(tx, { ...input, source: 'MANUAL', onExisting: 'reject' }));
}

type CreationMatricula = NonNullable<Awaited<ReturnType<typeof getContractCreationContext>>>['matricula'];

export async function syncContractSubscriptionForTenant(input: { contaId: string; contratoId: string; actorId: string; matricula: CreationMatricula }) {
  const matricula = input.matricula;
  const planoOuCombo = matricula.combo ?? matricula.plano;
  const periodicidade = (planoOuCombo?.periodicidade ?? PeriodicidadePlano.MENSAL) as PeriodicidadePlano;
  const cycle = mapPeriodicidadeToCycle(periodicidade);
  const mensalidade = matricula.cobrancas?.[0] ?? null;
  const billingType = mapFormaPagamentoToBillingType(mensalidade?.formaPagamento ?? matricula.formaPagamento ?? null);
  const mensalidadeValue = mensalidade?.valor != null ? Number(mensalidade.valor) : calcularPrecoMatricula({ planoValor: Number(planoOuCombo?.valor ?? 0), descontos: (matricula.descontos ?? []).map((item) => ({ tipo: item.desconto.tipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO', valor: Number(item.desconto.valor) })) }).planoLiquido;
  if (matricula.billingMode === 'SHARED_PLAN') return null;

  const existingSubscription = await prisma.subscription.findFirst({ where: { contaId: input.contaId, matriculaId: matricula.id }, select: { id: true, contratoId: true, asaasSubscriptionId: true } });
  if (matricula.asaasSubscriptionId) {
    if (existingSubscription && existingSubscription.contratoId !== input.contratoId) await prisma.subscription.update({ where: { id: existingSubscription.id }, data: { contratoId: input.contratoId } });
    else if (!existingSubscription) {
      const referencePlanId = matricula.combo?.id ?? matricula.plano?.id ?? input.contratoId;
      await prisma.subscription.create({ data: { contaId: input.contaId, contratoId: input.contratoId, matriculaId: matricula.id, externalReference: buildSubscriptionExternalReference({ matriculaId: matricula.id, planoId: referencePlanId }), asaasSubscriptionId: matricula.asaasSubscriptionId, status: 'REQUESTED', statusUpdatedAt: new Date() } });
    }
    const materializedPayment = mensalidade && !mensalidade.asaasPaymentId ? await materializeSubscriptionPaymentForCharge({ prisma, contaId: input.contaId, asaasSubscriptionId: matricula.asaasSubscriptionId, cobranca: { id: mensalidade.id, vencimento: mensalidade.vencimento, asaasPaymentId: mensalidade.asaasPaymentId }, intent: 'RECONCILIATION' }) : null;
    return { success: true, asaasSubscriptionId: matricula.asaasSubscriptionId, asaasPaymentId: materializedPayment?.payment?.id ?? mensalidade?.asaasPaymentId ?? null, invoiceUrl: materializedPayment?.payment?.invoiceUrl ?? null, bankSlipUrl: materializedPayment?.payment?.bankSlipUrl ?? null, expectedWebhooks: mensalidade?.asaasPaymentId || materializedPayment?.found ? [] : ['PAYMENT_CREATED'], message: materializedPayment?.found ? 'A cobrança recorrente já existia e o primeiro payment foi reconciliado diretamente com o Asaas.' : 'A cobrança recorrente já foi solicitada na finalização da matrícula. O primeiro ciclo será materializado pelo webhook oficial do Asaas.' };
  }
  if (!billingType || mensalidadeValue <= 0) return { success: false, error: mensalidadeValue <= 0 ? 'VALOR_ASSINATURA_INVALIDO' : 'FORMA_PAGAMENTO_INVALIDA' };
  const nextDueDateObj = resolveChargeableFirstDueDate(matricula.dataInicio, matricula.vencimentoDia);
  const discountValue = matricula.descontoAntecipado ? Number(matricula.descontoAntecipado) : 0;
  const fineValue = matricula.multaPercentual ? Number(matricula.multaPercentual) : 0;
  const result = await createSubscription({ contaId: input.contaId, contratoId: input.contratoId, matriculaId: matricula.id, value: mensalidadeValue, nextDueDate: formatIsoDate(nextDueDateObj), billingType, cycle, description: planoOuCombo?.nome ? `Mensalidade - ${planoOuCombo.nome}` : 'Mensalidade', endDate: matricula.dataFimContrato >= nextDueDateObj ? formatIsoDate(matricula.dataFimContrato) : undefined, discount: discountValue > 0 ? { value: discountValue, dueDateLimitDays: matricula.prazoDesconto ?? 0, type: (matricula.descontoTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE' } : undefined, interest: matricula.jurosMensal && Number(matricula.jurosMensal) > 0 ? { value: Number(matricula.jurosMensal) } : undefined, fine: fineValue > 0 ? { value: fineValue, type: (matricula.multaTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE' } : undefined, actor: { type: 'USER', id: input.actorId } });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, asaasSubscriptionId: result.data.asaasSubscriptionId ?? null, asaasPaymentId: null, invoiceUrl: null, bankSlipUrl: null, expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'], message: 'A assinatura foi criada no Asaas. O primeiro ciclo será materializado pelo webhook oficial.' };
}
