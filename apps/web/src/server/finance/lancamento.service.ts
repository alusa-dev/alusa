import { prisma } from '@/lib/prisma';
import type { OrigemLancamento, Prisma, StatusLancamento } from '@prisma/client';
import type { FinanceiroLancamentoInputDTO } from '@/features/financeiro/dtos';

type ListInput = {
  contaId: string;
  page: number;
  pageSize: number;
  tipo?: string;
  status: string[];
  origem: string[];
  centroCustoId?: string;
  categoriaId?: string;
  subcategoriaId?: string;
  search?: string;
  from?: string | null;
  to?: string | null;
  sort: 'valor' | 'dataEfetiva';
  order: 'asc' | 'desc';
};

function parseDate(input?: string | null): Date | undefined {
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function extractPaymentId(item: { externalRef?: string | null; referencia?: string | null }) {
  const external = item.externalRef ?? '';
  if (external.startsWith('asaas:payment:')) return external.slice('asaas:payment:'.length) || null;
  const referencia = item.referencia ?? '';
  if (referencia.startsWith('pagamento:')) return referencia.slice('pagamento:'.length) || null;
  return null;
}

function isMeaningfulDescription(value?: string | null) {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  return !/^pagamento (confirmado|recebido)/i.test(normalized);
}

export async function listFinanceiroLancamentos(input: ListInput) {
  const where: Prisma.LancamentoWhereInput = { contaId: input.contaId };
  const andFilters: Prisma.LancamentoWhereInput[] = [];

  if (input.tipo) where.tipo = input.tipo as Prisma.LancamentoWhereInput['tipo'];
  if (input.status.length) where.status = { in: input.status as StatusLancamento[] };
  if (input.origem.length) where.origem = { in: input.origem as OrigemLancamento[] };
  if (input.centroCustoId) where.centroCustoId = input.centroCustoId;
  if (input.categoriaId) where.categoriaId = input.categoriaId;
  if (input.subcategoriaId) where.subcategoriaId = input.subcategoriaId;
  if (input.search) {
    andFilters.push({
      OR: [
        { descricao: { contains: input.search, mode: 'insensitive' } },
        { referencia: { contains: input.search, mode: 'insensitive' } },
      ],
    });
  }

  const from = parseDate(input.from);
  const to = parseDate(input.to);
  if (from) andFilters.push({ OR: [{ dataEfetiva: { gte: from } }, { dataPrevista: { gte: from } }] });
  if (to) andFilters.push({ OR: [{ dataEfetiva: { lte: to } }, { dataPrevista: { lte: to } }] });
  if (andFilters.length) where.AND = andFilters;

  const orderBy: Prisma.LancamentoOrderByWithRelationInput[] = [
    input.sort === 'valor' ? { valor: input.order } : { dataEfetiva: input.order },
    { createdAt: 'desc' },
  ];
  const [total, items] = await prisma.$transaction([
    prisma.lancamento.count({ where }),
    prisma.lancamento.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: { centroCusto: true, categoria: true, subcategoria: true },
    }),
  ]);

  const paymentIds = Array.from(
    new Set(
      items
        .map((item) => extractPaymentId(item))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [cobrancasByPayment, chargesByPayment] = paymentIds.length
    ? await Promise.all([
        prisma.cobranca.findMany({
          where: {
            asaasPaymentId: { in: paymentIds },
            matricula: { aluno: { contaId: input.contaId } },
          },
          select: {
            id: true,
            asaasPaymentId: true,
            descricao: true,
            tipo: true,
            valor: true,
            asaasValue: true,
            asaasNetValue: true,
            matricula: { select: { aluno: { select: { nome: true } } } },
          },
        }),
        prisma.charge.findMany({
          where: { contaId: input.contaId, asaasPaymentId: { in: paymentIds } },
          select: {
            id: true,
            asaasPaymentId: true,
            description: true,
            value: true,
            payerName: true,
            cobranca: {
              select: {
                descricao: true,
                tipo: true,
                valor: true,
                asaasValue: true,
                asaasNetValue: true,
                matricula: { select: { aluno: { select: { nome: true } } } },
              },
            },
          },
        }),
      ])
    : [[], []];

  const cobrancaMap = new Map(
    cobrancasByPayment
      .filter((row) => Boolean(row.asaasPaymentId))
      .map((row) => [row.asaasPaymentId as string, row]),
  );
  const chargeMap = new Map(
    chargesByPayment
      .filter((row) => Boolean(row.asaasPaymentId))
      .map((row) => [row.asaasPaymentId as string, row]),
  );

  const enrichedItems = items.map((item) => {
    const paymentId = extractPaymentId(item);
    const cobranca = paymentId ? cobrancaMap.get(paymentId) : null;
    const charge = paymentId ? chargeMap.get(paymentId) : null;
    const alunoNome = cobranca?.matricula.aluno.nome ?? charge?.cobranca?.matricula.aluno.nome ?? null;
    const chargeDescription = charge?.description ?? null;
    const cobrancaDescription = cobranca?.descricao ?? charge?.cobranca?.descricao ?? null;
    const tipo = cobranca?.tipo ?? charge?.cobranca?.tipo ?? null;

    let nomeCobranca: string | null = null;
    if (isMeaningfulDescription(chargeDescription)) nomeCobranca = chargeDescription!.trim();
    else if (isMeaningfulDescription(cobrancaDescription)) nomeCobranca = cobrancaDescription!.trim();
    else if (tipo === 'PARCELADA') nomeCobranca = `Parcelamento${alunoNome ? ` - ${alunoNome}` : ''}`;
    else if (tipo === 'MENSALIDADE' || tipo === 'RECORRENTE') nomeCobranca = `Assinatura${alunoNome ? ` - ${alunoNome}` : ''}`;
    else if (alunoNome) nomeCobranca = `Cobrança Avulsa - ${alunoNome}`;
    else if (charge?.payerName) nomeCobranca = `Cobrança Avulsa - ${charge.payerName}`;

    const bruto = cobranca?.asaasValue != null
      ? Number(cobranca.asaasValue)
      : charge?.cobranca?.asaasValue != null
        ? Number(charge.cobranca.asaasValue)
        : null;
    const liquido = cobranca?.asaasNetValue != null
      ? Number(cobranca.asaasNetValue)
      : charge?.cobranca?.asaasNetValue != null
        ? Number(charge.cobranca.asaasNetValue)
        : null;
    const valorLiquido = liquido ?? Number(item.valor);
    const valorTaxa = bruto != null ? Math.max(0, Number((bruto - valorLiquido).toFixed(2))) : null;

    return { ...item, nomeCobranca, valorBruto: bruto, valorTaxa, valorLiquido };
  });

  const totals = enrichedItems.reduce(
    (acc, item) => {
      const value = Number(item.valor);
      const sign = item.isEstorno ? -1 : 1;
      if (item.tipo === 'RECEITA') acc.receitas += sign * value;
      if (item.tipo === 'DESPESA') acc.despesas += sign * value;
      if (item.isEstorno) acc.estornos += value;
      acc.liquido = acc.receitas - acc.despesas;
      return acc;
    },
    { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
  );

  return { items: enrichedItems, total, totals };
}

async function ensureCategoria(contaId: string, tipo: 'RECEITA' | 'DESPESA', categoriaId?: string | null) {
  if (!categoriaId) return { ok: true as const, id: null };
  const category = await prisma.categoriaLancamento.findFirst({
    where: { id: categoriaId, contaId, tipo },
    select: { id: true },
  });
  return category
    ? { ok: true as const, id: category.id }
    : { ok: false as const, message: 'Categoria nao encontrada para esta conta ou tipo' };
}

async function ensureCentroCusto(contaId: string, tipo: 'RECEITA' | 'DESPESA', centroId?: string | null) {
  if (!centroId) return { ok: true as const, id: null };
  const center = await prisma.centroCusto.findFirst({
    where: { id: centroId, contaId, status: 'ATIVO' },
    select: { id: true, tipo: true },
  });
  if (!center) return { ok: false as const, message: 'Centro de custo nao encontrado ou inativo' };
  if (center.tipo !== 'MISTO' && center.tipo !== tipo) {
    return { ok: false as const, message: 'Centro de custo incompatível com o tipo do lancamento' };
  }
  return { ok: true as const, id: center.id };
}

export async function createFinanceiroLancamento(input: {
  contaId: string;
  userId: string;
  data: FinanceiroLancamentoInputDTO;
}) {
  const { contaId, userId, data } = input;
  const origem = data.origem ?? 'MANUAL';
  const categoria = await ensureCategoria(contaId, data.tipo, data.categoriaId);
  if (!categoria.ok) return categoria;
  const subcategoria = await ensureCategoria(contaId, data.tipo, data.subcategoriaId);
  if (!subcategoria.ok) return subcategoria;
  const centro = await ensureCentroCusto(contaId, data.tipo, data.centroCustoId);
  if (!centro.ok) return centro;
  if (data.origem === 'MANUAL' && !centro.id) {
    return { ok: false as const, message: 'Centro de custo é obrigatório para lançamentos manuais' };
  }

  const created = await prisma.lancamento.create({
    data: {
      contaId,
      tipo: data.tipo,
      origem,
      status: data.status,
      valor: data.valor,
      descricao: data.descricao,
      referencia: data.referencia || null,
      centroCustoId: centro.id,
      categoriaId: categoria.id,
      subcategoriaId: subcategoria.id,
      formaPagamento: data.formaPagamento || null,
      dataEfetiva: parseDate(data.dataEfetiva),
      dataPrevista: parseDate(data.dataPrevista),
      observacao: data.observacao || null,
      anexoUrl: data.anexoUrl || null,
      externalRef: data.externalRef || null,
      createdById: userId,
    },
    include: { centroCusto: true, categoria: true, subcategoria: true },
  });

  return { ok: true as const, data: created };
}

export function getFinanceiroLancamento(input: { contaId: string; lancamentoId: string }) {
  return prisma.lancamento.findFirst({
    where: { id: input.lancamentoId, contaId: input.contaId },
    include: { categoria: true, subcategoria: true, parent: true, centroCusto: true },
  });
}

export async function updateFinanceiroLancamento(input: {
  contaId: string;
  lancamentoId: string;
  data: FinanceiroLancamentoInputDTO;
}) {
  const { contaId, lancamentoId, data } = input;
  const current = await getFinanceiroLancamento({ contaId, lancamentoId });
  if (!current) return { ok: false as const, code: 'NAO_ENCONTRADO', message: 'Lancamento nao encontrado' };
  if (current.origem === 'SISTEMA') {
    return { ok: false as const, code: 'IMUTAVEL', message: 'Lancamentos de origem Asaas sao imutaveis. Use a plataforma Asaas para ajustes.' };
  }
  if (current.isEstorno) return { ok: false as const, code: 'BLOQUEADO', message: 'Nao e possivel editar um estorno' };
  if (current.parentId) return { ok: false as const, code: 'BLOQUEADO', message: 'Lancamento vinculado a estorno nao pode ser alterado' };
  if (data.tipo !== current.tipo) return { ok: false as const, code: 'BLOQUEADO', message: 'Nao e permitido alterar o tipo' };
  if (data.status === 'ESTORNADO') return { ok: false as const, code: 'USE_ESTORNO', message: 'Use a acao de estorno dedicada' };

  const categoria = await ensureCategoria(contaId, data.tipo, data.categoriaId);
  if (!categoria.ok) return { ok: false as const, code: 'DADOS_INVALIDOS', message: categoria.message };
  const subcategoria = await ensureCategoria(contaId, data.tipo, data.subcategoriaId);
  if (!subcategoria.ok) return { ok: false as const, code: 'DADOS_INVALIDOS', message: subcategoria.message };
  const centro = await ensureCentroCusto(contaId, data.tipo, data.centroCustoId);
  if (!centro.ok) return { ok: false as const, code: 'DADOS_INVALIDOS', message: centro.message };
  if (current.origem === 'MANUAL' && !centro.id) {
    return { ok: false as const, code: 'DADOS_INVALIDOS', message: 'Centro de custo é obrigatório para lançamentos manuais' };
  }

  const updateResult = await prisma.lancamento.updateMany({
    where: { id: lancamentoId, contaId },
    data: {
      status: data.status,
      valor: data.valor,
      descricao: data.descricao,
      referencia: data.referencia || null,
      centroCustoId: centro.id,
      categoriaId: categoria.id,
      subcategoriaId: subcategoria.id,
      formaPagamento: data.formaPagamento || null,
      dataEfetiva: parseDate(data.dataEfetiva),
      dataPrevista: parseDate(data.dataPrevista),
      observacao: data.observacao || null,
      anexoUrl: data.anexoUrl || null,
      externalRef: data.externalRef || null,
    },
  });
  if (updateResult.count === 0) return { ok: false as const, code: 'NAO_ENCONTRADO', message: 'Lancamento nao encontrado' };

  const updated = await getFinanceiroLancamento({ contaId, lancamentoId });
  return updated
    ? { ok: true as const, data: updated }
    : { ok: false as const, code: 'NAO_ENCONTRADO', message: 'Lancamento nao encontrado' };
}

export async function estornarFinanceiroLancamento(input: {
  contaId: string;
  userId: string;
  lancamentoId: string;
  dataEstorno?: string;
  motivo?: string;
}) {
  const lancamento = await getFinanceiroLancamento({
    contaId: input.contaId,
    lancamentoId: input.lancamentoId,
  });
  if (!lancamento) return { ok: false as const, code: 'NAO_ENCONTRADO', message: 'Lancamento nao encontrado' };
  if (lancamento.origem === 'SISTEMA') {
    return { ok: false as const, code: 'IMUTAVEL', message: 'Lancamentos de origem Asaas nao podem ser estornados manualmente. Estornos devem ocorrer via plataforma Asaas.' };
  }
  if (lancamento.isEstorno) return { ok: false as const, code: 'BLOQUEADO', message: 'Nao e possivel estornar um estorno' };
  if (lancamento.status === 'ESTORNADO') return { ok: false as const, code: 'BLOQUEADO', message: 'Lancamento ja estornado' };

  const canReverse =
    (lancamento.tipo === 'RECEITA' && lancamento.status === 'RECEBIDO') ||
    (lancamento.tipo === 'DESPESA' && lancamento.status === 'PAGO');
  if (!canReverse) return { ok: false as const, code: 'BLOQUEADO', message: 'Somente recebidos/pagos podem ser estornados' };

  const dataEstorno = parseDate(input.dataEstorno) ?? new Date();
  const motivoEstorno = input.motivo?.trim() || null;
  const ajuste = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.lancamento.updateMany({
      where: {
        id: lancamento.id,
        contaId: input.contaId,
        status: lancamento.status,
        isEstorno: false,
      },
      data: { status: 'ESTORNADO', dataEstorno, motivoEstorno },
    });
    if (updateResult.count === 0) return null;

    return tx.lancamento.create({
      data: {
        contaId: input.contaId,
        tipo: lancamento.tipo,
        origem: lancamento.origem,
        status: 'ESTORNADO',
        valor: lancamento.valor,
        descricao: `Estorno de ${lancamento.descricao}`,
        referencia: lancamento.referencia,
        centroCustoId: lancamento.centroCustoId,
        categoriaId: lancamento.categoriaId,
        subcategoriaId: lancamento.subcategoriaId,
        formaPagamento: lancamento.formaPagamento,
        dataEfetiva: dataEstorno,
        dataPrevista: null,
        isEstorno: true,
        parentId: lancamento.id,
        dataEstorno,
        motivoEstorno,
        observacao: lancamento.observacao,
        anexoUrl: lancamento.anexoUrl,
        externalRef: lancamento.externalRef,
        createdById: input.userId,
      },
      include: { categoria: true, subcategoria: true, centroCusto: true },
    });
  });

  return ajuste
    ? { ok: true as const, data: ajuste }
    : { ok: false as const, code: 'CONCORRENCIA', message: 'O lançamento foi alterado por outra operação. Atualize e tente novamente.' };
}
