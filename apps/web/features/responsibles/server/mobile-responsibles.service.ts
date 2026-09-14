import { Prisma } from '@prisma/client';

import { mapUpdateResponsavelDTOToData } from '@/features/responsaveis/mappers';
import { updateResponsavelInputDTOSchema } from '@/features/responsaveis/dtos';
import { prisma } from '@/lib/prisma';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';
import {
  findCustomerForPayer,
  getAsaasCustomerNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  syncResponsavelAsaasCustomer,
  type CustomerNotificationPreferenceInput,
} from '@alusa/finance';

export class MobileResponsibleUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileResponsibleUnauthorizedError';
  }
}

export class MobileResponsibleNotFoundError extends Error {
  constructor() {
    super('Responsável não encontrado.');
    this.name = 'MobileResponsibleNotFoundError';
  }
}

async function assertActiveMembership(tx: TenantTransactionClient, userId: string, contaId: string) {
  const membership = await tx.usuarioConta.findFirst({
    where: {
      usuarioId: userId,
      contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true },
  });

  if (!membership) throw new MobileResponsibleUnauthorizedError();
}

export async function assertMobileResponsibleAccess(input: { userId: string; contaId: string }) {
  await runWithTenant(input.contaId, (tx) => assertActiveMembership(tx, input.userId, input.contaId));
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function numberValue(value: unknown) {
  return value === null || value === undefined ? 0 : Number(value);
}

function addressValue(value: {
  enderecoCep: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoComplemento: string | null;
  enderecoBairro: string | null;
  enderecoCidade: string | null;
  enderecoUf: string | null;
}) {
  const fields = [value.enderecoCep, value.enderecoLogradouro, value.enderecoNumero, value.enderecoComplemento, value.enderecoBairro, value.enderecoCidade, value.enderecoUf];
  if (!fields.some(Boolean)) return null;
  return {
    cep: value.enderecoCep,
    street: value.enderecoLogradouro,
    number: value.enderecoNumero,
    complement: value.enderecoComplemento,
    neighborhood: value.enderecoBairro,
    city: value.enderecoCidade,
    state: value.enderecoUf,
  };
}

type ResponsibleRecord = {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  foto: string | null;
  financeiro: boolean;
  consentimentoComunicacoes: boolean;
  consentimentoMarketing: boolean;
  asaasCustomerId: string | null;
  usuarioId: string | null;
  enderecoCep: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoComplemento: string | null;
  enderecoBairro: string | null;
  enderecoCidade: string | null;
  enderecoUf: string | null;
  alunos: Array<{
    tipoVinculo: string;
    aluno: { id: string; nome: string; foto: string | null; status: string };
  }>;
  matriculasFinanceiras: Array<{
    id: string;
    status: string;
    statusFinanceiro: string;
    statusContrato: string;
    dataInicio: Date;
    dataFimContrato: Date;
    aluno: { id: string; nome: string };
    plano: { nome: string } | null;
    combo: { nome: string } | null;
    turma: { nome: string } | null;
  }>;
};

function summary(record: Pick<ResponsibleRecord, 'id' | 'nome' | 'cpf' | 'email' | 'telefone' | 'foto' | 'financeiro' | 'consentimentoComunicacoes' | 'consentimentoMarketing' | 'alunos'>) {
  const active = record.alunos.some(({ aluno }) => aluno.status === 'ATIVO');
  return {
    id: record.id,
    name: record.nome,
    photo: record.foto,
    cpf: record.cpf,
    email: record.email,
    phone: record.telefone,
    financial: record.financeiro,
    status: active ? 'ATIVO' : 'INATIVO',
    communicationConsent: record.consentimentoComunicacoes,
    marketingConsent: record.consentimentoMarketing,
    studentsCount: record.alunos.length,
  };
}

export type MobileResponsibleListItem = ReturnType<typeof summary>;

export async function listMobileResponsibles(input: { userId: string; contaId: string; query?: string; status?: 'ALL' | 'ACTIVE' | 'INACTIVE' }) {
  return runWithTenant(input.contaId, async (tx) => {
    await assertActiveMembership(tx, input.userId, input.contaId);
    const query = input.query?.trim();
    const responsaveis = await tx.responsavel.findMany({
      where: {
        contaId: input.contaId,
        ...(query ? { OR: [{ nome: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }, { cpf: { contains: query.replace(/\D/g, '') } }] } : {}),
      },
      orderBy: { nome: 'asc' },
      take: 100,
      select: {
        id: true, nome: true, cpf: true, email: true, telefone: true, foto: true, financeiro: true,
        consentimentoComunicacoes: true, consentimentoMarketing: true,
        alunos: { select: { tipoVinculo: true, aluno: { select: { id: true, nome: true, foto: true, status: true } } } },
      },
    });

    const items = responsaveis.map(summary).filter((item) => input.status === 'ACTIVE' ? item.status === 'ATIVO' : input.status === 'INACTIVE' ? item.status !== 'ATIVO' : true);
    return { responsibles: items };
  });
}

function chargeWhere(contaId: string, responsibleId: string): Prisma.ChargeWhereInput {
  return {
    contaId,
    OR: [
      { payerType: 'RESPONSAVEL', payerId: responsibleId },
      { cobranca: { contaId, matricula: { responsavelFinanceiroId: responsibleId } } },
    ],
  };
}

export async function getMobileResponsibleDetail(input: { userId: string; contaId: string; responsibleId: string }) {
  await assertMobileResponsibleAccess(input);
  return runWithTenant(input.contaId, async (tx) => {
    const responsible = await tx.responsavel.findFirst({
      where: { id: input.responsibleId, contaId: input.contaId },
      select: {
        id: true, nome: true, cpf: true, email: true, telefone: true, foto: true, financeiro: true,
        consentimentoComunicacoes: true, consentimentoMarketing: true, asaasCustomerId: true, usuarioId: true,
        enderecoCep: true, enderecoLogradouro: true, enderecoNumero: true, enderecoComplemento: true,
        enderecoBairro: true, enderecoCidade: true, enderecoUf: true,
        alunos: {
          orderBy: { aluno: { nome: 'asc' } },
          select: { tipoVinculo: true, aluno: { select: { id: true, nome: true, foto: true, status: true } } },
        },
        matriculasFinanceiras: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, status: true, statusFinanceiro: true, statusContrato: true, dataInicio: true, dataFimContrato: true,
            aluno: { select: { id: true, nome: true } },
            plano: { select: { nome: true } }, combo: { select: { nome: true } }, turma: { select: { nome: true } },
          },
        },
      },
    });
    if (!responsible) throw new MobileResponsibleNotFoundError();

    const [charges, subscriptions, installmentPlans, sales] = await Promise.all([
      tx.charge.findMany({ where: chargeWhere(input.contaId, input.responsibleId), orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, description: true, value: true, dueDate: true, status: true, billingType: true, createdAt: true } }),
      tx.subscription.findMany({ where: { contaId: input.contaId, matricula: { responsavelFinanceiroId: input.responsibleId } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, createdAt: true, matricula: { select: { plano: { select: { nome: true } }, combo: { select: { nome: true } } } } } }),
      tx.installmentPlan.findMany({ where: { contaId: input.contaId, matricula: { responsavelFinanceiroId: input.responsibleId } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, value: true, billingType: true, firstDueDate: true, installmentCount: true, createdAt: true } }),
      tx.sale.count({ where: { contaId: input.contaId, responsavelId: input.responsibleId } }),
    ]);

    return {
      ...summary(responsible),
      customer: responsible.asaasCustomerId,
      userId: responsible.usuarioId,
      address: addressValue(responsible),
      metrics: { students: responsible.alunos.length, enrollments: responsible.matriculasFinanceiras.length, sales },
      students: responsible.alunos.map((item) => ({ id: item.aluno.id, name: item.aluno.nome, photo: item.aluno.foto, status: item.aluno.status, relationship: item.tipoVinculo })),
      enrollments: responsible.matriculasFinanceiras.map((item) => ({ id: item.id, studentId: item.aluno.id, studentName: item.aluno.nome, status: item.status, financialStatus: item.statusFinanceiro, contractStatus: item.statusContrato, startDate: item.dataInicio.toISOString(), contractEndDate: item.dataFimContrato.toISOString(), planName: item.plano?.nome ?? null, comboName: item.combo?.nome ?? null, className: item.turma?.nome ?? null })),
      charges: charges.map((charge) => ({ id: charge.id, description: charge.description ?? 'Cobrança', amount: numberValue(charge.value), dueDate: dateValue(charge.dueDate), status: charge.status, paymentMethod: charge.billingType, createdAt: charge.createdAt.toISOString() })),
      agreements: [
        ...subscriptions.map((item) => ({ id: item.id, kind: 'SUBSCRIPTION' as const, status: item.status, value: 0, frequency: 'RECORRENTE', nextDate: null, installments: null, name: item.matricula.plano?.nome ?? item.matricula.combo?.nome ?? 'Assinatura', createdAt: item.createdAt.toISOString() })),
        ...installmentPlans.map((item) => ({ id: item.id, kind: 'INSTALLMENT' as const, status: item.status, value: numberValue(item.value), frequency: item.billingType, nextDate: item.firstDueDate.toISOString(), installments: item.installmentCount, name: 'Parcelamento', createdAt: item.createdAt.toISOString() })),
      ],
    };
  });
}

export async function updateMobileResponsible(input: { userId: string; contaId: string; responsibleId: string; data: unknown }) {
  await assertMobileResponsibleAccess(input);
  const parsed = updateResponsavelInputDTOSchema.parse(input.data);
  const data = mapUpdateResponsavelDTOToData(parsed);
  if (Object.keys(data).length === 0) throw new Error('Informe ao menos um campo válido para atualizar.');
  const current = await prisma.responsavel.findFirst({ where: { id: input.responsibleId, contaId: input.contaId }, select: { id: true, financeiro: true } });
  if (!current) throw new MobileResponsibleNotFoundError();
  const updated = await prisma.responsavel.update({ where: { id: current.id }, data: data as Prisma.ResponsavelUpdateInput, select: { id: true, financeiro: true } });
  const touchedAddress = parsed.endereco != null || Object.keys(data).some((field) => field.startsWith('endereco'));
  const touchedContact = ['nome', 'cpf', 'email', 'telefone'].some((field) => field in data);
  if ((touchedAddress || touchedContact) && updated.financeiro) {
    await syncResponsavelAsaasCustomer({ contaId: input.contaId, responsavelId: updated.id, requireFiscalAddress: touchedAddress, notificationSyncMode: 'deferred' });
  }
  return { success: true as const };
}

export async function deleteMobileResponsible(input: { userId: string; contaId: string; responsibleId: string }) {
  await assertMobileResponsibleAccess(input);
  const result = await prisma.$transaction(async (tx) => {
    const linked = await tx.alunoResponsavel.count({ where: { contaId: input.contaId, responsavelId: input.responsibleId } });
    const enrollments = await tx.matricula.count({ where: { contaId: input.contaId, responsavelFinanceiroId: input.responsibleId, status: { notIn: ['CANCELADA', 'RECUSADA'] } } });
    const pendingCharges = await tx.charge.count({ where: { ...chargeWhere(input.contaId, input.responsibleId), status: { in: ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'] } } });
    if (linked || enrollments || pendingCharges) throw new Error('Não é possível excluir enquanto houver alunos, matrículas ou cobranças vinculadas.');
    await tx.customerPayer.deleteMany({ where: { contaId: input.contaId, payerType: 'RESPONSAVEL', payerId: input.responsibleId } });
    return tx.responsavel.deleteMany({ where: { id: input.responsibleId, contaId: input.contaId } });
  });
  if (!result.count) throw new MobileResponsibleNotFoundError();
  return { success: true as const };
}

function mapPreferences(preferences: Awaited<ReturnType<typeof getAsaasCustomerNotificationPreferences>>) {
  return preferences.map(({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer }) => ({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer }));
}

async function notificationCustomer(input: { contaId: string; responsibleId: string }) {
  const [customer, responsible] = await Promise.all([
    findCustomerForPayer(input.contaId, 'RESPONSAVEL', input.responsibleId),
    prisma.responsavel.findFirst({ where: { id: input.responsibleId, contaId: input.contaId }, select: { nome: true, asaasCustomerId: true } }),
  ]);
  if (!responsible) throw new MobileResponsibleNotFoundError();
  return { customerId: customer?.asaasCustomerId ?? responsible.asaasCustomerId, recipientName: responsible.nome };
}

export async function getMobileResponsibleNotifications(input: { userId: string; contaId: string; responsibleId: string }) {
  await assertMobileResponsibleAccess(input);
  const context = await notificationCustomer(input);
  if (!context.customerId) return { source: 'unavailable' as const, recipientName: context.recipientName, preferences: [] };
  return { source: 'responsible' as const, recipientName: context.recipientName, preferences: mapPreferences(await getAsaasCustomerNotificationPreferences(input.contaId, context.customerId)) };
}

export async function saveMobileResponsibleNotifications(input: { userId: string; contaId: string; responsibleId: string; preferences: CustomerNotificationPreferenceInput[] }) {
  await assertMobileResponsibleAccess(input);
  const context = await notificationCustomer(input);
  if (!context.customerId) return { source: 'unavailable' as const, recipientName: context.recipientName, preferences: [] };
  return { source: 'responsible' as const, recipientName: context.recipientName, preferences: mapPreferences(await saveAsaasCustomerNotificationPreferences(input.contaId, context.customerId, input.preferences)) };
}
