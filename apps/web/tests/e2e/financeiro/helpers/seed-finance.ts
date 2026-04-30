import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type SeedResult = {
  contaId: string;

  // Cobranças standalone avulsas
  standaloneCurrentPending: string; // id do Charge
  standalonePastOverdue: string;
  standaloneFuture: string;
  standalonePaid: string;

  // Parcelamento standalone
  standaloneInstallmentPlanId: string;
  installmentChargeCurrent: string;
  installmentChargeFuture: string;

  // Assinatura acadêmica
  subscriptionId: string;
  subscriptionChargeCurrentId: string;
  subscriptionChargeFutureId: string;

  // Parcelamento acadêmico
  academicInstallmentPlanId: string;
  academicInstallmentChargeCurrentId: string;
  academicInstallmentChargeFutureId: string;

  // Responsável / Aluno
  responsavelId: string;
  alunoId: string;
  matriculaId: string;
  customerId: string;
};

// ---------------------------------------------------------------------------
// Helpers de data
// ---------------------------------------------------------------------------

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function midMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 15);
}

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------

export async function seedFinanceData(
  prisma: PrismaClient,
  contaId: string,
): Promise<SeedResult> {
  const now = new Date();
  const currentMid = midMonth(now);
  const pastMid = midMonth(addMonths(now, -1));
  const futureMid = midMonth(addMonths(now, 1));

  // 1. Responsável financeiro
  const responsavel = await prisma.responsavel.create({
    data: {
      contaId,
      nome: 'Maria Financeiro E2E',
      cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
      email: `resp-${randomUUID()}@test.local`,
      telefone: '11999990000',
      financeiro: true,
      asaasCustomerId: `cust_e2e_${randomUUID().slice(0, 8)}`,
    },
    select: { id: true, asaasCustomerId: true },
  });

  // 2. Customer local
  const customer = await prisma.customer.create({
    data: {
      contaId,
      payerType: 'RESPONSAVEL',
      payerId: responsavel.id,
      externalReference: `customer:${randomUUID()}`,
      asaasCustomerId: responsavel.asaasCustomerId,
    },
    select: { id: true },
  });

  // 3. Aluno + Matrícula (para fluxos acadêmicos)
  const aluno = await prisma.aluno.create({
    data: {
      contaId,
      nome: 'João Aluno E2E',
      dataNasc: new Date('2008-06-15'),
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  const matricula = await prisma.matricula.create({
    data: {
      alunoId: aluno.id,
      dataInicio: startOfMonth(now),
      dataFimContrato: endOfMonth(addMonths(now, 11)),
      status: 'ATIVA',
      taxaMatricula: new Prisma.Decimal('200.00'),
    },
    select: { id: true },
  });

  const contrato = await prisma.contrato.create({
    data: {
      matriculaId: matricula.id,
      arquivoPdfUrl: 'https://example.com/contrato-e2e.pdf',
      hashPdf: createHash('sha256').update(randomUUID()).digest('hex'),
    },
    select: { id: true },
  });

  // =====================================================================
  // 4. Cobranças standalone avulsas
  // =====================================================================

  const mkChargeRef = () => `charge:${randomUUID()}`;

  // 4a. Pendente do mês atual (deve aparecer em "Todas" e "Avulsas")
  const standaloneCurrentPending = await prisma.charge.create({
    data: {
      contaId,
      externalReference: mkChargeRef(),
      status: 'OPEN',
      payerName: 'Maria Financeiro E2E',
      description: 'Material didático',
      value: new Prisma.Decimal('150.00'),
      dueDate: currentMid,
      billingType: 'PIX',
      customerId: customer.id,
    },
    select: { id: true },
  });

  // 4b. Vencida do mês anterior (deve aparecer em "Todas")
  const standalonePastOverdue = await prisma.charge.create({
    data: {
      contaId,
      externalReference: mkChargeRef(),
      status: 'OVERDUE',
      payerName: 'Maria Financeiro E2E',
      description: 'Uniforme escolar',
      value: new Prisma.Decimal('250.00'),
      dueDate: pastMid,
      billingType: 'BOLETO',
      customerId: customer.id,
    },
    select: { id: true },
  });

  // 4c. Futura (NÃO deve aparecer em "Todas")
  const standaloneFuture = await prisma.charge.create({
    data: {
      contaId,
      externalReference: mkChargeRef(),
      status: 'OPEN',
      payerName: 'Maria Financeiro E2E',
      description: 'Taxa de exame futuro',
      value: new Prisma.Decimal('100.00'),
      dueDate: futureMid,
      billingType: 'PIX',
      customerId: customer.id,
    },
    select: { id: true },
  });

  // 4d. Paga (NÃO deve aparecer em "Todas" com statusView=open)
  const standalonePaid = await prisma.charge.create({
    data: {
      contaId,
      externalReference: mkChargeRef(),
      status: 'PAID',
      payerName: 'Maria Financeiro E2E',
      description: 'Apostila paga',
      value: new Prisma.Decimal('80.00'),
      dueDate: pastMid,
      billingType: 'PIX',
      customerId: customer.id,
    },
    select: { id: true },
  });

  // =====================================================================
  // 5. Parcelamento standalone (2 parcelas)
  // =====================================================================

  const standaloneInstallmentPlan = await prisma.standaloneInstallmentPlan.create({
    data: {
      contaId,
      customerId: customer.id,
      externalReference: `standalone-installment:${randomUUID()}`,
      idempotencyKey: randomUUID(),
      status: 'ACTIVE',
      installmentCount: 2,
      billingType: 'BOLETO',
      value: new Prisma.Decimal('600.00'), // total
      firstDueDate: currentMid,
    },
    select: { id: true },
  });

  // Parcela 1 (este mês – operacional)
  const installmentChargeCurrent = await prisma.charge.create({
    data: {
      contaId,
      externalReference: `installment:${standaloneInstallmentPlan.id}:1:${randomUUID()}`,
      status: 'OPEN',
      payerName: 'Maria Financeiro E2E',
      description: 'Parcela 1/2',
      value: new Prisma.Decimal('300.00'),
      dueDate: currentMid,
      billingType: 'BOLETO',
      customerId: customer.id,
      standaloneInstallmentPlanId: standaloneInstallmentPlan.id,
    },
    select: { id: true },
  });

  // Parcela 2 (mês seguinte – NÃO operacional)
  const installmentChargeFuture = await prisma.charge.create({
    data: {
      contaId,
      externalReference: `installment:${standaloneInstallmentPlan.id}:2:${randomUUID()}`,
      status: 'OPEN',
      payerName: 'Maria Financeiro E2E',
      description: 'Parcela 2/2',
      value: new Prisma.Decimal('300.00'),
      dueDate: futureMid,
      billingType: 'BOLETO',
      customerId: customer.id,
      standaloneInstallmentPlanId: standaloneInstallmentPlan.id,
    },
    select: { id: true },
  });

  // =====================================================================
  // 6. Assinatura acadêmica + cobranças vinculadas (Cobranca → Charge)
  // =====================================================================

  const subscription = await prisma.subscription.create({
    data: {
      contaId,
      contratoId: contrato.id,
      matriculaId: matricula.id,
      externalReference: `subscription:${randomUUID()}`,
      status: 'ACTIVE',
      asaasSubscriptionId: `sub_e2e_${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });

  await prisma.matricula.update({
    where: { id: matricula.id },
    data: { asaasSubscriptionId: subscription.id },
  });

  // Cobrança acadêmica do mês atual (pendente – aparece em "Todas")
  const cobrancaCurrent = await prisma.cobranca.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'MENSALIDADE',
      descricao: 'Mensalidade vigente',
      competenciaInicio: startOfMonth(now),
      competenciaFim: endOfMonth(now),
      valor: new Prisma.Decimal('500.00'),
      vencimento: currentMid,
      status: 'PENDENTE',
      formaPagamento: 'BOLETO',
    },
    select: { id: true },
  });

  const subscriptionChargeCurrentId = await prisma.charge.create({
    data: {
      contaId,
      cobrancaId: cobrancaCurrent.id,
      externalReference: `subscription:${subscription.id}:${randomUUID()}`,
      status: 'OPEN',
      asaasPaymentId: `pay_sub_cur_${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });

  // Cobrança acadêmica futura (NÃO aparece em "Todas")
  const cobrancaFuture = await prisma.cobranca.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'MENSALIDADE',
      descricao: 'Mensalidade futura',
      competenciaInicio: startOfMonth(addMonths(now, 1)),
      competenciaFim: endOfMonth(addMonths(now, 1)),
      valor: new Prisma.Decimal('500.00'),
      vencimento: futureMid,
      status: 'A_VENCER',
      formaPagamento: 'BOLETO',
    },
    select: { id: true },
  });

  const subscriptionChargeFutureId = await prisma.charge.create({
    data: {
      contaId,
      cobrancaId: cobrancaFuture.id,
      externalReference: `subscription:${subscription.id}:${randomUUID()}`,
      status: 'OPEN',
    },
    select: { id: true },
  });

  // =====================================================================
  // 7. Parcelamento acadêmico (3 parcelas)
  // =====================================================================

  const academicInstallmentPlan = await prisma.installmentPlan.create({
    data: {
      contaId,
      contratoId: contrato.id,
      matriculaId: matricula.id,
      externalReference: `installmentPlan:${randomUUID()}`,
      status: 'ACTIVE',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: new Prisma.Decimal('200.00'), // por parcela
      firstDueDate: currentMid,
    },
    select: { id: true },
  });

  // Parcela acadêmica 1 (mês atual – operacional)
  const acInstCobranca1 = await prisma.cobranca.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'MENSALIDADE',
      descricao: 'Parcela acad. 1/3',
      competenciaInicio: startOfMonth(now),
      competenciaFim: endOfMonth(now),
      valor: new Prisma.Decimal('200.00'),
      vencimento: currentMid,
      status: 'PENDENTE',
      formaPagamento: 'BOLETO',
    },
    select: { id: true },
  });

  const academicInstallmentChargeCurrent = await prisma.charge.create({
    data: {
      contaId,
      cobrancaId: acInstCobranca1.id,
      externalReference: `installmentPlan:${academicInstallmentPlan.id}:1:${randomUUID()}`,
      status: 'OPEN',
      asaasPaymentId: `pay_inst_cur_${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });

  // Parcela acadêmica 2 (mês seguinte – NÃO operacional)
  const acInstCobranca2 = await prisma.cobranca.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'MENSALIDADE',
      descricao: 'Parcela acad. 2/3',
      competenciaInicio: startOfMonth(addMonths(now, 1)),
      competenciaFim: endOfMonth(addMonths(now, 1)),
      valor: new Prisma.Decimal('200.00'),
      vencimento: futureMid,
      status: 'A_VENCER',
      formaPagamento: 'BOLETO',
    },
    select: { id: true },
  });

  const academicInstallmentChargeFuture = await prisma.charge.create({
    data: {
      contaId,
      cobrancaId: acInstCobranca2.id,
      externalReference: `installmentPlan:${academicInstallmentPlan.id}:2:${randomUUID()}`,
      status: 'OPEN',
    },
    select: { id: true },
  });

  return {
    contaId,
    standaloneCurrentPending: standaloneCurrentPending.id,
    standalonePastOverdue: standalonePastOverdue.id,
    standaloneFuture: standaloneFuture.id,
    standalonePaid: standalonePaid.id,
    standaloneInstallmentPlanId: standaloneInstallmentPlan.id,
    installmentChargeCurrent: installmentChargeCurrent.id,
    installmentChargeFuture: installmentChargeFuture.id,
    subscriptionId: subscription.id,
    subscriptionChargeCurrentId: subscriptionChargeCurrentId.id,
    subscriptionChargeFutureId: subscriptionChargeFutureId.id,
    academicInstallmentPlanId: academicInstallmentPlan.id,
    academicInstallmentChargeCurrentId: academicInstallmentChargeCurrent.id,
    academicInstallmentChargeFutureId: academicInstallmentChargeFuture.id,
    responsavelId: responsavel.id,
    alunoId: aluno.id,
    matriculaId: matricula.id,
    customerId: customer.id,
  };
}
