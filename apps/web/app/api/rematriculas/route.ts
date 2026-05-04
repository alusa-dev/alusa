import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  listarRematriculasElegiveis,
  type RematriculaElegivelItem,
} from '@/src/server/matriculas/rematricula.service';
import {
  rematricularAluno,
  createAsaasPaymentsProvider,
  type RematricularAlunoError,
} from '@alusa/finance';
import { prisma } from '@/src/prisma';
import { FormaPagamento, StatusContrato } from '@prisma/client';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  createRematriculaInputDTOSchema,
  createRematriculaResultDTOSchema,
  listRematriculasQueryDTOSchema,
} from '@/features/cadastro/rematriculas/dtos';
import {
  mapCreateRematriculaResultToDTO,
  mapListRematriculasResultToDTO,
} from '@/features/cadastro/rematriculas/mappers';
import {
  buildFinancialSnapshot,
  evaluateRematriculaDecision,
  getContaFinancialPolicy,
  serializeFinancialSnapshot,
  serializePolicySnapshot,
} from '@/src/server/matriculas/rematricula-financial-policy.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

async function resolveAuthContext(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = user?.contaId?.trim() || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId, session, user };
  }
  return {
    contaId: requested || sessionContaId,
    mismatch: false,
    sessionContaId,
    session,
    user,
  };
}

async function loadRematriculaDecision(params: {
  contaId: string;
  matriculaId: string;
  currentUserRole?: string | null;
}) {
  const [policy, matricula] = await Promise.all([
    getContaFinancialPolicy(params.contaId),
    prisma.matricula.findFirst({
      where: { id: params.matriculaId, aluno: { contaId: params.contaId } },
      select: {
        id: true,
        status: true,
        dataFimContrato: true,
        integrationStatus: true,
        statusFinanceiro: true,
        cobrancas: {
          where: {
            status: {
              in: ['A_VENCER', 'PENDENTE', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'],
            },
          },
          select: { status: true },
        },
      },
    }),
  ]);

  if (!matricula) {
    return null;
  }

  const diasRestantes = Math.ceil(
    (matricula.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const academicEligible = validarElegibilidadeRematricula({
    status: matricula.status,
    contratoExpirado: diasRestantes < 0,
  }).success;

  const financialSnapshot = buildFinancialSnapshot({
    cobrancas: matricula.cobrancas,
    statusFinanceiro: matricula.statusFinanceiro,
    integrationStatus: matricula.integrationStatus,
    debtScope: policy.debtScope,
  });

  const decision = evaluateRematriculaDecision({
    academicEligible,
    financialSnapshot,
    policy,
    currentUserRole: params.currentUserRole,
  });

  return { policy, financialSnapshot, decision, academicEligible };
}

async function auditBlockedAttempt(params: {
  matriculaId: string;
  actorId: string;
  policySnapshot: ReturnType<typeof serializePolicySnapshot>;
  financialSnapshot: ReturnType<typeof serializeFinancialSnapshot>;
  reason: string;
  decisionMessage: string;
  overrideReason?: string;
}) {
  await prisma.matriculaLog.create({
    data: {
      matriculaId: params.matriculaId,
      actorId: params.actorId,
      action: 'REMATRICULA_TENTATIVA_BLOQUEADA',
      metadata: {
        reason: params.reason,
        decisionMessage: params.decisionMessage,
        policySnapshot: params.policySnapshot,
        financialSnapshot: params.financialSnapshot,
        overrideReason: params.overrideReason ?? null,
      },
    },
  });
}

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length) {
    const n = Number(value.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseInteger(value: unknown) {
  const parsed = parseNumber(value);
  return parsed !== undefined ? Math.trunc(parsed) : undefined;
}

function normalizeRematriculaBillingMode(value: unknown) {
  if (value === 'SHARED_PLAN') return 'SHARED_PLAN';
  if (value === 'INDIVIDUAL') return 'INDIVIDUAL';
  return undefined;
}

function toDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim().length) {
    const trimmed = value.trim();
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (!Number.isNaN(date.getTime())) return date;
    }

    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function normalizarFormaPagamento(raw: unknown): FormaPagamento | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const normalized = raw.trim().toUpperCase();
  const mapping: Record<string, FormaPagamento> = {
    CARTAO: FormaPagamento.CARTAO_CREDITO,
    CARTAO_CREDITO: FormaPagamento.CARTAO_CREDITO,
    PIX: FormaPagamento.PIX,
    BOLETO: FormaPagamento.BOLETO,
    DINHEIRO: FormaPagamento.INDEFINIDO,
    INDEFINIDO: FormaPagamento.INDEFINIDO,
  };
  const mapped = mapping[normalized];
  return mapped && Object.values(FormaPagamento).includes(mapped) ? mapped : undefined;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const auth = await resolveAuthContext(url.searchParams.get('contaId'));

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (!auth.user?.id || !auth.user.role || !allowedRoles.has(auth.user.role.toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        'Usuário não tem permissão para consultar rematrículas.',
      );
    }

    const queryDTO = listRematriculasQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId') ?? undefined,
      diasAntecedencia: Number(url.searchParams.get('diasAntecedencia') ?? '60'),
      referencia: url.searchParams.get('referencia') ?? undefined,
      statusContrato: url.searchParams.get('statusContrato') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    const dias = queryDTO.diasAntecedencia;
    const referenciaParam = queryDTO.referencia;
    const statusContratoParam = queryDTO.statusContrato;
    const statusContratoValue =
      statusContratoParam &&
      Object.values(StatusContrato).includes(statusContratoParam as StatusContrato)
        ? (statusContratoParam as StatusContrato)
        : undefined;

    const result = await listarRematriculasElegiveis({
      contaId: auth.contaId,
      diasAntecedencia: Number.isFinite(dias) ? dias : 60,
      referencia: referenciaParam ? toDate(referenciaParam) : undefined,
      statusContrato: statusContratoValue,
      search: url.searchParams.get('q') ?? url.searchParams.get('search') ?? undefined,
      currentUserRole: auth.user.role,
    });

    const itens = result.itens.map((item: RematriculaElegivelItem) => ({
      id: item.id,
      status: item.status,
      statusContrato: item.statusContrato,
      dataInicio: item.dataInicio.toISOString(),
      dataFimContrato: item.dataFimContrato.toISOString(),
      diasRestantes: item.diasRestantes,
      contratoExpirado: item.contratoExpirado,
      podeRenovar: item.podeRenovar,
      eligibilityStatus: item.eligibilityStatus,
      aluno: item.aluno,
      plano: item.plano,
      turma: item.turma,
      combo: item.combo,
      financeiro: item.financeiro,
    }));

    return NextResponse.json(
      mapListRematriculasResultToDTO({
        referencia: result.referencia.toISOString(),
        ate: result.ate.toISOString(),
        total: result.total,
        itens,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[API Rematrículas] Erro ao listar:', error);
    return jsonError(500, 'ERRO_LISTAR_REMATRICULAS', (error as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido');
    }
    const body = createRematriculaInputDTOSchema.parse(rawBody);

    const auth = await resolveAuthContext(body.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (!auth.user?.id || !auth.user.role || !allowedRoles.has(auth.user.role.toUpperCase())) {
      return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematricular.');
    }

    const formaPagamento = normalizarFormaPagamento(body.formaPagamento);

    const matriculaId = body.matriculaId;
    if (!matriculaId) {
      return jsonError(400, 'MATRICULA_OBRIGATORIA', 'matriculaId é obrigatório.');
    }

    const dataInicioValue = toDate(body.dataInicio) ?? new Date();
    const dataFimContratoValue = toDate(body.dataFimContrato);
    if (!dataFimContratoValue) {
      return jsonError(400, 'DATA_FIM_CONTRATO_OBRIGATORIA', 'dataFimContrato é obrigatório.');
    }

    const rematriculaDecision = await loadRematriculaDecision({
      contaId: auth.contaId,
      matriculaId,
      currentUserRole: auth.user.role,
    });

    if (!rematriculaDecision) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');
    }

    const policySnapshot = serializePolicySnapshot(rematriculaDecision.policy);
    const financialSnapshot = serializeFinancialSnapshot(rematriculaDecision.financialSnapshot);
    const overrideReason =
      typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '';

    if (rematriculaDecision.decision.actionStatus === 'BLOQUEADA') {
      await auditBlockedAttempt({
        matriculaId,
        actorId: auth.user.id,
        policySnapshot,
        financialSnapshot,
        reason: rematriculaDecision.decision.blockReason,
        decisionMessage: rematriculaDecision.decision.message,
      });

      return jsonError(409, 'REMATRICULA_BLOQUEADA', rematriculaDecision.decision.message, {
        actionStatus: rematriculaDecision.decision.actionStatus,
        blockReason: rematriculaDecision.decision.blockReason,
      });
    }

    if (rematriculaDecision.decision.actionStatus === 'REQUER_OVERRIDE') {
      if (!rematriculaDecision.decision.canCurrentUserOverride) {
        await auditBlockedAttempt({
          matriculaId,
          actorId: auth.user.id,
          policySnapshot,
          financialSnapshot,
          reason: 'OVERRIDE_SEM_PERMISSAO',
          decisionMessage: rematriculaDecision.decision.message,
          overrideReason,
        });

        return jsonError(
          403,
          'OVERRIDE_SEM_PERMISSAO',
          'Seu perfil não pode autorizar esta rematrícula.',
        );
      }

      if (rematriculaDecision.decision.requiresOverrideReason && !overrideReason) {
        await auditBlockedAttempt({
          matriculaId,
          actorId: auth.user.id,
          policySnapshot,
          financialSnapshot,
          reason: 'OVERRIDE_MOTIVO_OBRIGATORIO',
          decisionMessage: rematriculaDecision.decision.message,
        });

        return jsonError(
          422,
          'OVERRIDE_MOTIVO_OBRIGATORIO',
          'Informe o motivo da autorização administrativa.',
        );
      }
    }

    // Converter formaPagamento para o formato esperado pelo use case
    const formaPagamentoMap: Record<string, 'BOLETO' | 'PIX' | 'CARTAO_CREDITO'> = {
      BOLETO: 'BOLETO',
      PIX: 'PIX',
      CARTAO_CREDITO: 'CARTAO_CREDITO',
    };

    const result = await rematricularAluno(
      {
        contaId: auth.contaId,
        matriculaId,
        createdById: auth.user.id,
        dataInicio: dataInicioValue,
        dataFimContrato: dataFimContratoValue,
        planoId: body.planoId ?? null,
        turmaId: body.turmaId ?? null,
        comboId: body.comboId ?? null,
        responsavelFinanceiroId: body.responsavelFinanceiroId ?? null,
        formaPagamento: formaPagamento ? formaPagamentoMap[formaPagamento] : undefined,
        vencimentoDia: parseInteger(body.vencimentoDia),
        billingMode: normalizeRematriculaBillingMode(body.billingMode),
        valorMensalidadeOverride: parseNumber(body.valorMensalidadeOverride),
        taxaMatricula: parseNumber(body.taxaMatricula),
        taxaIsenta: body.taxaIsenta === true || body.taxaIsenta === 'true',
        taxaJustificativa:
          typeof body.taxaJustificativa === 'string' ? body.taxaJustificativa.trim() : undefined,
        formaPagamentoTaxa: body.formaPagamentoTaxa
          ? formaPagamentoMap[body.formaPagamentoTaxa]
          : undefined,
        descontos: Array.isArray(body.descontos)
          ? body.descontos
              .map((desconto) => ({
                id: typeof desconto?.id === 'string' ? desconto.id : '',
                cumulativo: desconto?.cumulativo === true,
              }))
              .filter((desconto) => desconto.id)
          : undefined,
        multaPercentual: parseNumber(body.multaPercentual),
        jurosMensal: parseNumber(body.jurosMensal),
        descontoAntecipado: parseNumber(body.descontoAntecipado),
        prazoDesconto: parseInteger(body.prazoDesconto),
        overrideReason: overrideReason || undefined,
        policyContext: {
          actionStatus: rematriculaDecision.decision.actionStatus,
          blockReason: rematriculaDecision.decision.blockReason,
          policySnapshot,
          financialSnapshot,
          overrideUsed: rematriculaDecision.decision.actionStatus === 'REQUER_OVERRIDE',
          overrideApprovedById:
            rematriculaDecision.decision.actionStatus === 'REQUER_OVERRIDE'
              ? auth.user.id
              : undefined,
        },
      },
      {
        prisma,
        paymentsProvider: createAsaasPaymentsProvider(),
      },
    );

    if (!result.success) {
      return mapRematriculaErrorToResponse(result.error);
    }

    // Resposta neutra (sem referências ao provedor de pagamentos)
    const novaMatricula = await prisma.matricula.findFirst({
      where: { id: result.data.matriculaIdNova, aluno: { contaId: auth.contaId } },
      select: {
        id: true,
        planoId: true,
        turmaId: true,
        status: true,
        statusContrato: true,
        dataInicio: true,
        dataFimContrato: true,
        asaasSubscriptionId: true,
        vencimentoDia: true,
        responsavelFinanceiro: {
          select: {
            id: true,
            nome: true,
            cpf: true,
          },
        },
      },
    });

    const matriculaAnterior = await prisma.matricula.findFirst({
      where: { id: matriculaId, aluno: { contaId: auth.contaId } },
      select: {
        dataInicio: true,
        dataFimContrato: true,
        turmaId: true,
        planoId: true,
      },
    });

    const primeiroVencimento = (() => {
      if (!novaMatricula?.vencimentoDia) return dataInicioValue.toISOString();
      const base = new Date(dataInicioValue);
      base.setMonth(base.getMonth() + 1);
      base.setDate(Math.min(28, novaMatricula.vencimentoDia));
      return base.toISOString();
    })();

    return NextResponse.json(
      createRematriculaResultDTOSchema.parse(
        mapCreateRematriculaResultToDTO({
          operationId: result.data.operationId,
          status: result.data.status,
          matriculaId: result.data.matriculaIdNova,
          message: result.data.uiMessage,
          novaMatricula: {
            id: novaMatricula?.id ?? result.data.matriculaIdNova,
            planoId: novaMatricula?.planoId ?? body.planoId ?? '',
            turmaId: novaMatricula?.turmaId ?? body.turmaId ?? null,
            status: novaMatricula?.status ?? 'ATIVA',
            statusContrato: novaMatricula?.statusContrato ?? 'AGUARDANDO_ASSINATURA',
            dataInicio: novaMatricula?.dataInicio?.toISOString() ?? dataInicioValue.toISOString(),
            dataFimContrato:
              novaMatricula?.dataFimContrato?.toISOString() ?? dataFimContratoValue.toISOString(),
            asaasSubscriptionId: novaMatricula?.asaasSubscriptionId ?? null,
          },
          historicoContrato: {
            dataInicioAnterior: matriculaAnterior?.dataInicio?.toISOString() ?? '',
            dataFimContratoAnterior: matriculaAnterior?.dataFimContrato?.toISOString() ?? '',
            turmaIdAnterior: matriculaAnterior?.turmaId ?? null,
            planoIdAnterior: matriculaAnterior?.planoId ?? '',
          },
          primeiroVencimento,
          responsavelFinanceiro: novaMatricula?.responsavelFinanceiro
            ? {
                id: novaMatricula.responsavelFinanceiro.id,
                nome: novaMatricula.responsavelFinanceiro.nome,
                cpf: novaMatricula.responsavelFinanceiro.cpf,
              }
            : null,
        }),
      ),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[API Rematrículas] Erro ao criar:', error);
    if ((error as { name?: string }).name === 'ZodError') {
      const zodError = error as { issues?: Array<{ path: string[]; message: string }> };
      const issues = zodError.issues || [];
      const firstIssue = issues[0];
      const message = firstIssue
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : 'Erro de validação';
      return jsonError(422, 'ERRO_VALIDACAO', message, { issues });
    }
    return jsonError(500, 'ERRO_CRIAR_REMATRICULA', (error as Error).message);
  }
}

function mapRematriculaErrorToResponse(error: RematricularAlunoError) {
  const errorMap: Record<string, { status: number; message: string }> = {
    MATRICULA_NAO_ENCONTRADA: { status: 404, message: 'Matrícula não encontrada.' },
    MATRICULA_PERTENCE_OUTRA_CONTA: {
      status: 403,
      message: 'Matrícula não pertence a esta conta.',
    },
    STATUS_INVALIDO: { status: 422, message: 'Status da matrícula não permite rematrícula.' },
    TURMA_SEM_VAGAS: { status: 422, message: 'Turma não possui vagas disponíveis.' },
    COMBO_SEM_VAGAS: { status: 422, message: 'Combo atingiu limite de vagas.' },
    CONFLITO_HORARIO: { status: 422, message: 'Conflito de horário detectado.' },
    DATA_INICIO_INVALIDA: { status: 422, message: 'Data de início inválida.' },
    DATA_FIM_ANTES_INICIO: { status: 422, message: 'Data fim deve ser posterior à data início.' },
    RESPONSAVEL_OBRIGATORIO_MENOR: {
      status: 422,
      message: 'Aluno menor de idade requer responsável financeiro.',
    },
    PLANO_NAO_ENCONTRADO: { status: 404, message: 'Plano não encontrado.' },
    TURMA_NAO_ENCONTRADA: { status: 404, message: 'Turma não encontrada.' },
    COMBO_NAO_ENCONTRADO: { status: 404, message: 'Combo não encontrado.' },
    OPERACAO_EM_ANDAMENTO: { status: 409, message: 'Já existe uma rematrícula em andamento.' },
    ERRO_PROVEDOR: { status: 502, message: 'Erro ao processar pagamento.' },
  };

  const mapped = errorMap[error.code] ?? { status: 500, message: 'Erro desconhecido.' };
  const details =
    'message' in error ? error.message : 'details' in error ? error.details : undefined;

  return jsonError(mapped.status, error.code, mapped.message, details);
}
