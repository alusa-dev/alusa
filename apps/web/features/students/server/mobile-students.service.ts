import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';
import prisma from '@/lib/prisma';
import { normalizeAvatarUpload } from '@/src/server/media/avatar-storage.service';
import {
  findCustomerForPayer,
  getAsaasCustomerNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  type CustomerNotificationPreferenceInput,
} from '@alusa/finance';

export type MobileStudent = {
  id: string;
  name: string;
  photo: string | null;
  status: string;
};

export class MobileStudentUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileStudentUnauthorizedError';
  }
}

export class MobileStudentNotFoundError extends Error {
  constructor() {
    super('Aluno não encontrado.');
    this.name = 'MobileStudentNotFoundError';
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

  if (!membership) throw new MobileStudentUnauthorizedError();
}

export async function assertMobileStudentAccess(input: { userId: string; contaId: string }) {
  await runWithTenant(input.contaId, async (tx) => {
    await assertActiveMembership(tx, input.userId, input.contaId);
  });
}

export async function listMobileStudents(input: { userId: string; contaId: string }) {
  return runWithTenant(input.contaId, async (tx) => {
    await assertActiveMembership(tx, input.userId, input.contaId);

    const students = await tx.aluno.findMany({
      where: { contaId: input.contaId },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        foto: true,
        status: true,
      },
    });

    return {
      students: students.map<MobileStudent>((student) => ({
        id: student.id,
        name: student.nome,
        photo: student.foto,
        status: student.status,
      })),
    };
  });
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
} | null) {
  if (!value) return null;
  const hasValue = [
    value.enderecoCep,
    value.enderecoLogradouro,
    value.enderecoNumero,
    value.enderecoComplemento,
    value.enderecoBairro,
    value.enderecoCidade,
    value.enderecoUf,
  ].some(Boolean);
  if (!hasValue) return null;
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

function mapResponsible(item: {
  tipoVinculo: string;
  responsavel: {
    id: string;
    nome: string;
    cpf: string;
    email: string;
    telefone: string;
    foto: string | null;
    financeiro: boolean;
    enderecoCep: string | null;
    enderecoLogradouro: string | null;
    enderecoNumero: string | null;
    enderecoComplemento: string | null;
    enderecoBairro: string | null;
    enderecoCidade: string | null;
    enderecoUf: string | null;
    consentimentoComunicacoes: boolean;
    consentimentoMarketing: boolean;
  };
}) {
  return {
    id: item.responsavel.id,
    name: item.responsavel.nome,
    cpf: item.responsavel.cpf,
    email: item.responsavel.email,
    phone: item.responsavel.telefone,
    relationship: item.tipoVinculo,
    financial: item.responsavel.financeiro || item.tipoVinculo === 'FINANCEIRO' || item.tipoVinculo === 'PRINCIPAL',
    photo: item.responsavel.foto,
    address: addressValue(item.responsavel),
    communicationConsent: item.responsavel.consentimentoComunicacoes,
    marketingConsent: item.responsavel.consentimentoMarketing,
  };
}

function mapCharge(charge: {
  id: string;
  descricao: string | null;
  valor: unknown;
  vencimento: Date;
  dataPagamento: Date | null;
  status: string;
  formaPagamento: string;
  tipo: string;
  createdAt: Date;
}) {
  return {
    id: charge.id,
    description: charge.descricao || 'Cobrança',
    amount: numberValue(charge.valor),
    dueDate: dateValue(charge.vencimento),
    paidAt: dateValue(charge.dataPagamento),
    status: charge.status,
    paymentMethod: charge.formaPagamento,
    type: charge.tipo,
    origin: 'ACADEMIC' as const,
    createdAt: charge.createdAt.toISOString(),
  };
}

function mapEnrollment(enrollment: {
  id: string;
  status: string;
  statusFinanceiro: string;
  statusContrato: string;
  dataInicio: Date;
  dataFim: Date | null;
  dataFimContrato: Date;
  vencimentoDia: number;
  taxaMatricula: unknown;
  taxaStatus: string;
  taxaIsenta: boolean;
  formaPagamento: string | null;
  formaPagamentoTaxa: string | null;
  turma: { id: string; nome: string; modalidade: { nome: string } } | null;
  matriculaTurmas: Array<{ turma: { id: string; nome: string; modalidade: { nome: string } } }>;
  plano: { id: string; nome: string; valor: unknown; periodicidade: string } | null;
  combo: { id: string; nome: string; valor: unknown; periodicidade: string } | null;
  contratoAtual: { id: string; status: string; assinadoEm: Date | null; createdAt: Date } | null;
  contratos: Array<{ id: string; status: string; assinadoEm: Date | null; createdAt: Date }>;
}) {
  return {
    id: enrollment.id,
    status: enrollment.status,
    financialStatus: enrollment.statusFinanceiro,
    contractStatus: enrollment.statusContrato,
    startDate: dateValue(enrollment.dataInicio),
    endDate: dateValue(enrollment.dataFim),
    contractEndDate: dateValue(enrollment.dataFimContrato),
    paymentDay: enrollment.vencimentoDia,
    enrollmentFee: numberValue(enrollment.taxaMatricula),
    enrollmentFeeStatus: enrollment.taxaStatus,
    enrollmentFeeExempt: enrollment.taxaIsenta,
    paymentMethod: enrollment.formaPagamento,
    enrollmentFeePaymentMethod: enrollment.formaPagamentoTaxa,
    class: enrollment.turma
      ? { id: enrollment.turma.id, name: enrollment.turma.nome, modality: enrollment.turma.modalidade.nome }
      : null,
    classes: enrollment.matriculaTurmas.map((item) => ({ id: item.turma.id, name: item.turma.nome, modality: item.turma.modalidade.nome })),
    plan: enrollment.plano
      ? { id: enrollment.plano.id, name: enrollment.plano.nome, value: numberValue(enrollment.plano.valor), frequency: enrollment.plano.periodicidade }
      : null,
    combo: enrollment.combo
      ? { id: enrollment.combo.id, name: enrollment.combo.nome, value: numberValue(enrollment.combo.valor), frequency: enrollment.combo.periodicidade }
      : null,
    contract: enrollment.contratoAtual
      ? { id: enrollment.contratoAtual.id, status: enrollment.contratoAtual.status, signedAt: dateValue(enrollment.contratoAtual.assinadoEm), createdAt: enrollment.contratoAtual.createdAt.toISOString() }
      : null,
    contracts: enrollment.contratos.map((contract) => ({ id: contract.id, status: contract.status, signedAt: dateValue(contract.assinadoEm), createdAt: contract.createdAt.toISOString() })),
  };
}

function mapAgreement(value: {
  id: string;
  status: string;
  value: unknown;
  billingType: string;
  nextDueDate?: Date | null;
  firstDueDate?: Date | null;
  createdAt: Date;
  installmentCount?: number;
}, kind: 'SUBSCRIPTION' | 'INSTALLMENT') {
  return {
    id: value.id,
    status: value.status,
    value: numberValue(value.value),
    frequency: value.billingType,
    nextDate: dateValue(value.nextDueDate ?? value.firstDueDate),
    createdAt: value.createdAt.toISOString(),
    kind,
    installments: value.installmentCount ?? null,
    paymentMethod: value.billingType,
  };
}
async function loadMobileStudent(studentId: string, contaId: string) {
  return runWithTenant(contaId, async (tx) => {
    const [student, standaloneCharges, standaloneSubscriptions, standalonePlans] = await Promise.all([
      tx.aluno.findFirst({
        where: { id: studentId, contaId },
        select: {
          id: true, nome: true, nomeSocial: true, dataNasc: true, cpf: true, email: true, telefone: true, foto: true, asaasCustomerId: true,
          status: true, observacao: true, genero: true, modalidadePrincipal: true, nivel: true, alergias: true,
          restricoesMedicas: true, contatoEmergenciaNome: true, contatoEmergenciaTelefone: true, origemCadastro: true,
          bolsaDescontoPercent: true, isentoTaxaMatricula: true, consentimentoImagem: true, consentimentoComunicacoes: true,
          consentimentoMarketing: true, tamanhoCamiseta: true, tamanhoCalcado: true, codigoInterno: true,
          tags: true, dataInativacao: true, motivoInativacao: true, updatedAt: true,
          enderecoCep: true, enderecoLogradouro: true, enderecoNumero: true, enderecoComplemento: true, enderecoBairro: true,
          enderecoCidade: true, enderecoUf: true,
          responsaveis: {
            orderBy: { id: 'asc' },
            select: {
              tipoVinculo: true,
              responsavel: {
                select: {
                  id: true, nome: true, cpf: true, email: true, telefone: true, foto: true, financeiro: true,
                  enderecoCep: true, enderecoLogradouro: true, enderecoNumero: true, enderecoComplemento: true,
                  enderecoBairro: true, enderecoCidade: true, enderecoUf: true, consentimentoComunicacoes: true,
                  consentimentoMarketing: true,
                },
              },
            },
          },
          matriculas: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, status: true, statusFinanceiro: true, statusContrato: true, dataInicio: true, dataFim: true,
              dataFimContrato: true, vencimentoDia: true, taxaMatricula: true, taxaStatus: true, taxaIsenta: true,
              formaPagamento: true, formaPagamentoTaxa: true,
              turma: { select: { id: true, nome: true, modalidade: { select: { nome: true } } } },
              plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
              combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
              contratoAtual: { select: { id: true, status: true, assinadoEm: true, createdAt: true } },
              contratos: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, assinadoEm: true, createdAt: true } },
              matriculaTurmas: { orderBy: { createdAt: 'asc' }, select: { turma: { select: { id: true, nome: true, modalidade: { select: { nome: true } } } } } },
              cobrancas: {
                orderBy: { vencimento: 'desc' },
                take: 50,
                select: { id: true, descricao: true, valor: true, vencimento: true, dataPagamento: true, status: true, formaPagamento: true, tipo: true, createdAt: true },
              },
              subscriptions: { select: { id: true, status: true, createdAt: true } },
              installmentPlans: { select: { id: true, status: true, value: true, billingType: true, firstDueDate: true, installmentCount: true, createdAt: true } },
            },
          },
        },
      }),
      tx.charge.findMany({
        where: { contaId, payerType: 'ALUNO', payerId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, description: true, value: true, dueDate: true, status: true, billingType: true, createdAt: true },
      }),
      tx.standaloneSubscription.findMany({
        where: { contaId, payerType: 'ALUNO', payerId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, value: true, billingType: true, nextDueDate: true, createdAt: true },
      }),
      tx.standaloneInstallmentPlan.findMany({
        where: { contaId, payerType: 'ALUNO', payerId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, value: true, billingType: true, firstDueDate: true, installmentCount: true, createdAt: true },
      }),
    ]);

    if (!student) throw new MobileStudentNotFoundError();

    const responsibleLinks = student.responsaveis.map(mapResponsible);
    const responsible = responsibleLinks.find((item) => item.financial) ?? responsibleLinks[0] ?? null;
    const academicCharges = student.matriculas.flatMap((item) => item.cobrancas.map(mapCharge));
    const directCharges = standaloneCharges.map((charge) => ({
      id: charge.id,
      description: charge.description || 'Cobrança',
      amount: numberValue(charge.value),
      dueDate: dateValue(charge.dueDate),
      paidAt: null,
      status: charge.status,
      paymentMethod: charge.billingType,
      type: 'AVULSA',
      origin: 'STANDALONE' as const,
      createdAt: charge.createdAt.toISOString(),
    }));

    return {
      id: student.id,
      name: student.nome,
      photo: student.foto,
      asaasCustomerId: student.asaasCustomerId,
      socialName: student.nomeSocial,
      birthDate: dateValue(student.dataNasc),
      cpf: student.cpf,
      email: student.email,
      phone: student.telefone,
      status: student.status,
      address: addressValue(student),
      notes: student.observacao,
      gender: student.genero,
      mainModality: student.modalidadePrincipal,
      level: student.nivel,
      allergies: student.alergias,
      medicalRestrictions: student.restricoesMedicas,
      emergencyContactName: student.contatoEmergenciaNome,
      emergencyContactPhone: student.contatoEmergenciaTelefone,
      registrationOrigin: student.origemCadastro,
      discountPercent: student.bolsaDescontoPercent === null ? null : numberValue(student.bolsaDescontoPercent),
      registrationFeeExempt: student.isentoTaxaMatricula,
      imageConsent: student.consentimentoImagem,
      communicationConsent: student.consentimentoComunicacoes,
      marketingConsent: student.consentimentoMarketing,
      shirtSize: student.tamanhoCamiseta,
      shoeSize: student.tamanhoCalcado,
      internalCode: student.codigoInterno,
      tags: student.tags,
      deactivatedAt: dateValue(student.dataInativacao),
      deactivationReason: student.motivoInativacao,
      responsible,
      responsibles: responsibleLinks,
      enrollments: student.matriculas.map(mapEnrollment),
      charges: [...academicCharges, ...directCharges].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      agreements: [
        ...standaloneSubscriptions.map((item) => mapAgreement(item, 'SUBSCRIPTION')),
        ...standalonePlans.map((item) => mapAgreement(item, 'INSTALLMENT')),
        ...student.matriculas.flatMap((item) => [
          ...item.subscriptions.map((subscription) => ({ id: subscription.id, status: subscription.status, value: numberValue(item.plano?.valor ?? item.combo?.valor), billingType: 'RECORRENTE', createdAt: subscription.createdAt })),
          ...item.installmentPlans.map((plan) => mapAgreement(plan, 'INSTALLMENT')),
        ]),
      ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      notifications: { source: 'unavailable' as const, recipientName: null, preferences: [] },
    };
  });
}

export async function getMobileStudentDetail(input: { userId: string; contaId: string; studentId: string }) {
  await assertMobileStudentAccess(input);
  return loadMobileStudent(input.studentId, input.contaId);
}

export async function updateMobileStudent(input: { userId: string; contaId: string; studentId: string; data: Record<string, unknown> }) {
  await assertMobileStudentAccess(input);
  const existing = await prisma.aluno.findFirst({ where: { id: input.studentId, contaId: input.contaId }, select: { foto: true } });
  if (!existing) throw new MobileStudentNotFoundError();
  const { updateAluno } = await import('@alusa/lib');
  const normalizedFoto = await normalizeAvatarUpload({ entity: 'aluno', entityId: input.studentId, contaId: input.contaId, foto: input.data.foto as string | null | undefined, previousFoto: existing.foto });
  await updateAluno({ ...(input.data as Parameters<typeof updateAluno>[0]), id: input.studentId, contaId: input.contaId, ...(normalizedFoto !== undefined ? { foto: normalizedFoto } : {}) });
}

type NotificationContext = {
  customerId: string | null;
  source: 'student' | 'responsible' | 'unavailable';
  recipientName: string | null;
};

async function resolveNotificationContext(studentId: string, contaId: string): Promise<NotificationContext> {
  const student = await prisma.aluno.findFirst({
    where: { id: studentId, contaId },
    select: {
      nome: true,
      asaasCustomerId: true,
      responsaveis: { select: { responsavel: { select: { id: true, nome: true, asaasCustomerId: true, financeiro: true } } } },
      matriculas: { orderBy: { createdAt: 'desc' }, select: { responsavelFinanceiro: { select: { id: true, nome: true, asaasCustomerId: true } } } },
    },
  });
  if (!student) throw new MobileStudentNotFoundError();
  const candidates = [
    { type: 'ALUNO' as const, id: studentId, name: student.nome, fallback: student.asaasCustomerId, source: 'student' as const },
    ...student.responsaveis.filter((item) => item.responsavel.financeiro).map((item) => ({ type: 'RESPONSAVEL' as const, id: item.responsavel.id, name: item.responsavel.nome, fallback: item.responsavel.asaasCustomerId, source: 'responsible' as const })),
    ...student.matriculas.flatMap((item) => item.responsavelFinanceiro ? [{ type: 'RESPONSAVEL' as const, id: item.responsavelFinanceiro.id, name: item.responsavelFinanceiro.nome, fallback: item.responsavelFinanceiro.asaasCustomerId, source: 'responsible' as const }] : []),
  ];
  for (const candidate of candidates) {
    const canonical = await findCustomerForPayer(contaId, candidate.type, candidate.id);
    const customerId = canonical?.asaasCustomerId ?? candidate.fallback;
    if (customerId) return { customerId, source: candidate.source, recipientName: candidate.name };
  }
  return { customerId: null, source: 'unavailable', recipientName: null };
}

export async function getMobileStudentNotifications(input: { userId: string; contaId: string; studentId: string }) {
  await assertMobileStudentAccess(input);
  const context = await resolveNotificationContext(input.studentId, input.contaId);
  if (!context.customerId) return { source: context.source, recipientName: context.recipientName, preferences: [] };
  const preferences = await getAsaasCustomerNotificationPreferences(input.contaId, context.customerId);
  return { source: context.source, recipientName: context.recipientName, preferences: preferences.map(({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer }) => ({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer })) };
}

export async function saveMobileStudentNotifications(input: { userId: string; contaId: string; studentId: string; preferences: CustomerNotificationPreferenceInput[] }) {
  await assertMobileStudentAccess(input);
  const context = await resolveNotificationContext(input.studentId, input.contaId);
  if (!context.customerId) return { source: context.source, recipientName: context.recipientName, preferences: [] };
  const preferences = await saveAsaasCustomerNotificationPreferences(input.contaId, context.customerId, input.preferences);
  return { source: context.source, recipientName: context.recipientName, preferences: preferences.map(({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer }) => ({ id, event, scheduleOffset, enabled, emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer })) };
}
