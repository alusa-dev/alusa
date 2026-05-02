import { prisma } from '@alusa/database';
import type { ChargeListItemDTO, UnifiedChargeStatus } from '../dtos/charge-list-item.dto';
import { parseExternalReference } from '../core';

export type ChargeOrigin = 'ACADEMIC' | 'STANDALONE' | 'all';

/**
 * Extrai installmentPlanId do externalReference
 * Suporta V1 (installmentPlan:{planId}:payment:{paymentId}) e V2 (alusa:installment:{planId}:{subcontaId})
 */
function extractInstallmentPlanId(externalReference: string | null): string | null {
  if (!externalReference) return null;
  
  // Tentar V2 primeiro
  const parsed = parseExternalReference(externalReference);
  if (parsed && parsed.type === 'installment' && parsed.ids.installmentPlanId) {
    return parsed.ids.installmentPlanId;
  }
  if (parsed && parsed.type === 'payment' && parsed.ids.installmentPlanId) {
    return parsed.ids.installmentPlanId;
  }
  
  // Fallback V1
  if (!externalReference.startsWith('installmentPlan:')) return null;
  const rest = externalReference.slice('installmentPlan:'.length);
  if (rest.startsWith('pending:')) {
    return rest.slice('pending:'.length).split(':')[0] || null;
  }
  return rest.split(':')[0] || null;
}

export type ListChargesAggregatedInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  statusFilter?: string[];
  statusView?: 'open' | 'paid' | 'all';
  tipoFilter?: string[];
  search?: string;
  /** Filtrar por origem: ACADEMIC (Cobranca), STANDALONE (Charge sem vínculo), ou 'all' */
  origin?: ChargeOrigin;
  /** Se true, agrupa parcelamentos em um único item (default: true) */
  groupInstallments?: boolean;
};

export type ListChargesAggregatedOutput = {
  items: ChargeListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Mapeamento de StatusCobranca para UnifiedChargeStatus
function mapCobrancaStatus(status: string): UnifiedChargeStatus {
  switch (status) {
    case 'A_VENCER':
    case 'PENDENTE':
      return 'PENDING';
    case 'PROCESSANDO':
      return 'PROCESSING';
    case 'PAGO':
      return 'PAID';
    case 'ATRASADO':
      return 'OVERDUE';
    case 'CANCELAMENTO_PENDENTE':
    case 'CANCELADO':
      return 'CANCELED';
    case 'ESTORNADO':
    case 'ESTORNADO_PARCIAL':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

// Mapeamento de ChargeStatus para UnifiedChargeStatus
function mapChargeStatus(status: string): UnifiedChargeStatus {
  switch (status) {
    case 'CREATED':
    case 'OPEN':
      return 'PENDING';
    case 'PAID':
      return 'PAID';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'CANCELED':
      return 'CANCELED';
    case 'REFUNDED':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

// Mapeamento de FormaPagamento para billing type
function mapBillingType(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null;
  switch (formaPagamento) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'CARTAO_DEBITO':
      return 'DEBIT_CARD';
    case 'INDEFINIDO':
      return 'UNDEFINED';
    default:
      return formaPagamento;
  }
}

// Mapeamento de TipoCobranca para descrição legível
function mapTipoToDescription(tipo: string): string {
  switch (tipo) {
    case 'MENSALIDADE':
      return 'Mensalidade';
    case 'TAXA_MATRICULA':
      return 'Taxa de Matrícula';
    case 'MATERIAL':
      return 'Material';
    case 'UNIFORME':
      return 'Uniforme';
    case 'EXTRA':
      return 'Extra';
    case 'AVULSA':
      return 'Cobrança Avulsa';
    case 'PARCELADA':
      return 'Parcelamento';
    case 'RECORRENTE':
      return 'Recorrente';
    default:
      return tipo;
  }
}

export async function listChargesAggregated(
  input: ListChargesAggregatedInput,
  /** Prisma client override (DI para testes) */
  db?: typeof prisma,
): Promise<ListChargesAggregatedOutput> {
  const _db = db ?? prisma;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, statusFilter, statusView = 'open', tipoFilter, search, origin = 'all' } = input;
  const enableV2InstallmentGrouping = process.env.FINANCE_GROUP_INSTALLMENTS_V2 === 'true';

  // Calcular limite extra para merge (buscar o dobro para garantir ordenação correta)
  const fetchLimit = pageSize * 2;

  // Skip queries based on origin filter
  const includeAcademic = origin === 'all' || origin === 'ACADEMIC';
  const includeStandalone = origin === 'all' || origin === 'STANDALONE';

  // ==================== Query 1: Cobranças Acadêmicas ====================
  const academicWhere: Record<string, unknown> = {
    matricula: { aluno: { contaId } },
  };

  // Aplicar filtros de status
  if (statusFilter?.length) {
    academicWhere.status = { in: statusFilter };
  } else if (statusView === 'open') {
    academicWhere.OR = [
      {
        status: {
          in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'],
        },
      },
      {
        status: 'PAGO',
        NOT: { liquidacaoStatus: 'DISPONIVEL' },
      },
    ];
  } else if (statusView === 'paid') {
    academicWhere.status = 'PAGO';
    academicWhere.liquidacaoStatus = 'DISPONIVEL';
  }

  if (tipoFilter?.length) {
    academicWhere.tipo = { in: tipoFilter };
  }

  if (search) {
    const searchOr = [
      { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } },
      { descricao: { contains: search, mode: 'insensitive' } },
    ];
    if (academicWhere.OR) {
      const existingOr = academicWhere.OR;
      delete academicWhere.OR;
      academicWhere.AND = [{ OR: existingOr }, { OR: searchOr }];
    } else {
      academicWhere.OR = searchOr;
    }
  }

  // ==================== Query 2: Cobranças Standalone ====================
  const standaloneWhere: Record<string, unknown> = {
    contaId,
    cobrancaId: null, // Apenas charges sem vínculo acadêmico
  };

  // Mapear statusFilter para ChargeStatus
  if (statusFilter?.length) {
    const chargeStatuses: string[] = [];
    for (const s of statusFilter) {
      if (['A_VENCER', 'PENDENTE'].includes(s)) {
        chargeStatuses.push('CREATED', 'OPEN');
      } else if (s === 'PAGO') {
        chargeStatuses.push('PAID');
      } else if (s === 'ATRASADO') {
        chargeStatuses.push('OVERDUE');
      } else if (['CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(s)) {
        chargeStatuses.push('CANCELED');
      } else if (['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(s)) {
        chargeStatuses.push('REFUNDED');
      }
    }
    if (chargeStatuses.length) {
      standaloneWhere.status = { in: [...new Set(chargeStatuses)] };
    }
  } else if (statusView === 'open') {
    standaloneWhere.status = { in: ['CREATED', 'OPEN', 'OVERDUE'] };
  } else if (statusView === 'paid') {
    standaloneWhere.status = 'PAID';
  }

  // ==================== Executar queries em paralelo ====================
  // Buscar Charges vinculadas para extrair installmentPlanId (quando groupInstallments=true)
  const shouldGroup = input.groupInstallments !== false; // default true

  const [academicResult, standaloneResult, academicCount, standaloneCount, linkedCharges] = await Promise.all([
    includeAcademic
      ? _db.cobranca.findMany({
          where: academicWhere,
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
          include: {
            matricula: {
              select: {
                id: true,
                aluno: { select: { id: true, nome: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    includeStandalone
      ? _db.charge.findMany({
          where: standaloneWhere,
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
          select: {
            id: true,
            contaId: true,
            externalReference: true,
            status: true,
            statusUpdatedAt: true,
            asaasPaymentId: true,
            createdAt: true,
            // Novos campos para listagem
            payerName: true,
            description: true,
            value: true,
            dueDate: true,
            billingType: true,
            standaloneInstallmentPlanId: true,
          },
        })
      : Promise.resolve([]),
    includeAcademic ? _db.cobranca.count({ where: academicWhere }) : Promise.resolve(0),
    includeStandalone ? _db.charge.count({ where: standaloneWhere }) : Promise.resolve(0),
    // Buscar Charges vinculadas às cobranças para extrair installmentPlanId
    shouldGroup && includeAcademic
      ? _db.charge.findMany({
          where: {
            contaId,
            cobrancaId: { not: null },
            OR: [
              { externalReference: { startsWith: 'installmentPlan:' } },
              ...(enableV2InstallmentGrouping
                ? [{ externalReference: { startsWith: 'alusa:installment:' } }]
                : []),
            ],
          },
          select: {
            cobrancaId: true,
            externalReference: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Criar mapa de cobrancaId -> installmentPlanId
  const cobrancaToInstallmentPlan = new Map<string, string>();
  const cobrancaToPaidStatus = new Map<string, string>();
  for (const charge of linkedCharges) {
    if (charge.cobrancaId) {
      const planId = extractInstallmentPlanId(charge.externalReference);
      if (planId) {
        cobrancaToInstallmentPlan.set(charge.cobrancaId, planId);
        cobrancaToPaidStatus.set(charge.cobrancaId, charge.status);
      } else if (
        enableV2InstallmentGrouping &&
        charge.externalReference &&
        charge.externalReference.includes('installment')
      ) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('[finance][listChargesAggregated] installmentPlanId não resolvido', {
            cobrancaId: charge.cobrancaId,
            externalReference: charge.externalReference,
          });
        }
      }
    }
  }

  // ==================== Normalizar para DTO ====================
  const academicItems: ChargeListItemDTO[] = academicResult.map((c) => ({
    id: c.id,
    origin: 'ACADEMIC' as const,
    description: c.descricao || mapTipoToDescription(c.tipo),
    payerName: c.matricula.aluno.nome,
    value: Number(c.valor),
    dueDate: c.vencimento?.toISOString() ?? null,
    billingType: mapBillingType(c.formaPagamento),
    status: mapCobrancaStatus(c.status),
    liquidacaoStatus: c.liquidacaoStatus,
    createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
    sourceId: c.id,
    matriculaId: c.matriculaId,
    alunoId: c.matricula.aluno.id,
    asaasPaymentId: c.asaasPaymentId,
    tipo: c.tipo,
    // Adicionar installmentPlanId para cobranças PARCELADA
    installmentPlanId: cobrancaToInstallmentPlan.get(c.id) ?? null,
  }));

  // Para standalone, usar os campos de snapshot salvos na criação
  const standaloneItems: ChargeListItemDTO[] = [];
  let standaloneExcludedCount = 0;

  for (const c of standaloneResult) {
    const hasInstallmentReference = !!extractInstallmentPlanId(c.externalReference);
    if (hasInstallmentReference && !c.standaloneInstallmentPlanId) {
      standaloneExcludedCount += 1;
      continue;
    }

    standaloneItems.push({
      id: c.id,
      origin: 'STANDALONE' as const,
      description: c.description ?? 'Cobrança Avulsa',
      payerName: c.payerName ?? 'Cliente',
      value: c.value != null ? Number(c.value) : 0,
      dueDate: c.dueDate?.toISOString() ?? null,
      billingType: c.billingType,
      status: mapChargeStatus(c.status),
      liquidacaoStatus: null,
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      sourceId: c.id,
      matriculaId: null,
      alunoId: null,
      asaasPaymentId: c.asaasPaymentId,
      tipo: c.standaloneInstallmentPlanId ? 'PARCELADA' : 'AVULSA',
      installmentPlanId: c.standaloneInstallmentPlanId ?? null,
    });
  }

  // ==================== Agrupar parcelamentos (se habilitado) ====================
  let processedItems: ChargeListItemDTO[];

  if (shouldGroup) {
    // Separar itens por tipo
    const installmentItems: ChargeListItemDTO[] = [];
    const otherItems: ChargeListItemDTO[] = [];

    for (const item of academicItems) {
      if (item.tipo === 'PARCELADA' && item.installmentPlanId) {
        installmentItems.push(item);
      } else {
        if (item.tipo === 'PARCELADA' && !item.installmentPlanId) {
          continue;
        }
        otherItems.push(item);
      }
    }

    const standaloneInstallmentItems = standaloneItems.filter((item) => item.installmentPlanId);
    const standaloneOtherItems = standaloneItems.filter((item) => !item.installmentPlanId);

    // Agrupar parcelas por installmentPlanId (acadêmico)
    const groupedByPlan = new Map<string, ChargeListItemDTO[]>();
    for (const item of installmentItems) {
      const planId = item.installmentPlanId!;
      if (!groupedByPlan.has(planId)) {
        groupedByPlan.set(planId, []);
      }
      groupedByPlan.get(planId)!.push(item);
    }

    // Buscar dados dos InstallmentPlans para criar itens de grupo
    const planIds = Array.from(groupedByPlan.keys());
    const installmentPlans =
      planIds.length > 0
        ? await _db.installmentPlan.findMany({
            where: { contaId, id: { in: planIds } },
            select: {
              id: true,
              installmentCount: true,
              value: true,
              billingType: true,
              firstDueDate: true,
              createdAt: true,
              matricula: {
                select: {
                  id: true,
                  aluno: { select: { id: true, nome: true } },
                },
              },
            },
          })
        : [];

    // Criar mapa de planos
    const planMap = new Map(installmentPlans.map((p) => [p.id, p]));

    // Criar itens de grupo
    const groupItems: ChargeListItemDTO[] = [];
    for (const [planId, parcelas] of groupedByPlan) {
      const plan = planMap.get(planId);
      if (!plan) continue;

      // Ordenar parcelas por vencimento
      parcelas.sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      // Contar parcelas pagas
      const paidCount = parcelas.filter((p) => p.status === 'PAID').length;

      // Calcular valor total e próximo vencimento
      const totalValue = Number(plan.value) * plan.installmentCount;
      const nextDue = parcelas.find((p) => p.status !== 'PAID' && p.status !== 'CANCELED');

      // Determinar status do grupo
      let groupStatus: UnifiedChargeStatus = 'PENDING';
      if (paidCount === plan.installmentCount) {
        groupStatus = 'PAID';
      } else if (parcelas.some((p) => p.status === 'OVERDUE')) {
        groupStatus = 'OVERDUE';
      } else if (parcelas.every((p) => p.status === 'CANCELED')) {
        groupStatus = 'CANCELED';
      }

      // Extrair descrição base (remover "Parcela X/Y - ")
      const baseDescription =
        parcelas[0]?.description?.replace(/^Parcela \d+\/\d+ - /, '') || 'Parcelamento';

      groupItems.push({
        id: `group:installment:${planId}`,
        origin: 'ACADEMIC',
        description: `Parcelamento ${plan.installmentCount}x - ${baseDescription}`,
        payerName: plan.matricula.aluno.nome,
        value: totalValue,
        dueDate: nextDue?.dueDate ?? parcelas[parcelas.length - 1]?.dueDate ?? null,
        billingType: plan.billingType,
        status: groupStatus,
        liquidacaoStatus: null,
        createdAt: plan.createdAt.toISOString(),
        sourceId: planId,
        matriculaId: plan.matricula.id,
        alunoId: plan.matricula.aluno.id,
        asaasPaymentId: null,
        tipo: 'PARCELADA',
        // Campos de grupo
        isGroup: true,
        groupType: 'INSTALLMENT',
        installmentPlanId: planId,
        installmentCount: plan.installmentCount,
        installmentsPaid: paidCount,
        installments: parcelas,
      });
    }

    // Agrupar parcelas por installmentPlanId (standalone)
    const groupedStandalone = new Map<string, ChargeListItemDTO[]>();
    for (const item of standaloneInstallmentItems) {
      const planId = item.installmentPlanId!;
      if (!groupedStandalone.has(planId)) {
        groupedStandalone.set(planId, []);
      }
      groupedStandalone.get(planId)!.push(item);
    }

    const standalonePlanIds = Array.from(groupedStandalone.keys());
    const standalonePlans = standalonePlanIds.length
      ? await _db.standaloneInstallmentPlan.findMany({
          where: { id: { in: standalonePlanIds } },
          select: {
            id: true,
            installmentCount: true,
            value: true,
            billingType: true,
            firstDueDate: true,
            createdAt: true,
            customer: { select: { payerType: true, payerId: true } },
          },
        })
      : [];

    const responsavelIds = standalonePlans
      .filter((p) => p.customer.payerType === 'RESPONSAVEL')
      .map((p) => p.customer.payerId);
    const alunoIds = standalonePlans
      .filter((p) => p.customer.payerType === 'ALUNO')
      .map((p) => p.customer.payerId);

    const [responsaveis, alunos] = await Promise.all([
      responsavelIds.length
        ? _db.responsavel.findMany({ where: { id: { in: responsavelIds } }, select: { id: true, nome: true } })
        : Promise.resolve([]),
      alunoIds.length
        ? _db.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, nome: true } })
        : Promise.resolve([]),
    ]);

    const responsavelMap = new Map(responsaveis.map((r) => [r.id, r.nome]));
    const alunoMap = new Map(alunos.map((a) => [a.id, a.nome]));

    const standalonePlanMap = new Map(standalonePlans.map((p) => [p.id, p]));
    const standaloneGroupItems: ChargeListItemDTO[] = [];

    for (const [planId, parcelas] of groupedStandalone) {
      const plan = standalonePlanMap.get(planId);
      if (!plan) continue;

      parcelas.sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      const paidCount = parcelas.filter((p) => p.status === 'PAID').length;
      const totalValue = Number(plan.value);
      const nextDue = parcelas.find((p) => p.status !== 'PAID' && p.status !== 'CANCELED');

      let groupStatus: UnifiedChargeStatus = 'PENDING';
      if (paidCount === plan.installmentCount) {
        groupStatus = 'PAID';
      } else if (parcelas.some((p) => p.status === 'OVERDUE')) {
        groupStatus = 'OVERDUE';
      } else if (parcelas.every((p) => p.status === 'CANCELED')) {
        groupStatus = 'CANCELED';
      }

      const payerName =
        plan.customer.payerType === 'RESPONSAVEL'
          ? responsavelMap.get(plan.customer.payerId) ?? parcelas[0]?.payerName ?? 'Cliente'
          : alunoMap.get(plan.customer.payerId) ?? parcelas[0]?.payerName ?? 'Cliente';

      const baseDescription = parcelas[0]?.description ?? 'Parcelamento';

      standaloneGroupItems.push({
        id: `group:standalone-installment:${planId}`,
        origin: 'STANDALONE',
        description: `Parcelamento ${plan.installmentCount}x - ${baseDescription}`,
        payerName,
        value: totalValue,
        dueDate: nextDue?.dueDate ?? parcelas[parcelas.length - 1]?.dueDate ?? plan.firstDueDate.toISOString(),
        billingType: plan.billingType,
        status: groupStatus,
        liquidacaoStatus: null,
        createdAt: plan.createdAt.toISOString(),
        sourceId: planId,
        matriculaId: null,
        alunoId: null,
        asaasPaymentId: null,
        tipo: 'PARCELADA',
        isGroup: true,
        groupType: 'INSTALLMENT',
        installmentPlanId: planId,
        installmentCount: plan.installmentCount,
        installmentsPaid: paidCount,
        installments: parcelas,
      });
    }

    // Combinar grupos + outros itens + standalone não-parceladas
    processedItems = [...groupItems, ...standaloneGroupItems, ...otherItems, ...standaloneOtherItems];
  } else {
    // Sem agrupamento - retornar tudo individualmente
    processedItems = [...academicItems, ...standaloneItems];
  }

  // Ordenar por data de criação (mais recente primeiro)
  processedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Aplicar paginação
  const skip = (page - 1) * pageSize;
  const paginatedItems = processedItems.slice(skip, skip + pageSize);

  // Calcular total corretamente (considerando agrupamento)
  const academicGroupCount = shouldGroup ? new Set(Array.from(cobrancaToInstallmentPlan.values())).size : 0;
  const academicInstallmentItemsCount = shouldGroup
    ? academicItems.filter((i) => i.tipo === 'PARCELADA' && i.installmentPlanId).length
    : 0;
  const standaloneInstallmentItemsCount = shouldGroup
    ? standaloneItems.filter((i) => i.tipo === 'PARCELADA' && i.installmentPlanId).length
    : 0;
  const standaloneGroupCount = shouldGroup
    ? new Set(standaloneItems.filter((i) => i.installmentPlanId).map((i) => i.installmentPlanId!)).size
    : 0;

  const adjustedTotal =
    academicCount +
    standaloneCount -
    standaloneExcludedCount -
    academicInstallmentItemsCount -
    standaloneInstallmentItemsCount +
    academicGroupCount +
    standaloneGroupCount;

  return {
    items: paginatedItems,
    total: shouldGroup ? adjustedTotal : academicCount + standaloneCount - standaloneExcludedCount,
    page,
    pageSize,
    totalPages: Math.ceil(
      (shouldGroup ? adjustedTotal : academicCount + standaloneCount - standaloneExcludedCount) / pageSize,
    ),
  };
}
