import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { StatusCobranca, StatusMatricula } from '@prisma/client';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import {
  updateAluno,
  deleteAluno,
  getAluno,
  buildAlunoArchivePlan,
} from '@alusa/lib';
import { AsaasCustomerEnsureError } from '@alusa/finance';
import { getPaymentsProviderForConta } from '@/src/server/finance/payments-provider.factory';
import {
  executeAlunoArchivePlan,
  type AlunoArchiveExecutionResult,
} from '@/src/server/alunos/aluno-archive.orchestrator';
import {
  alunoDeleteResultDTOSchema,
  alunoDetailDTOSchema,
  updateAlunoInputDTOSchema,
} from '@/features/cadastro/alunos/dtos';
import {
  mapAlunoDeleteResultToDTO,
  mapAlunoDetailToDTO,
} from '@/features/cadastro/alunos/mappers';
import { normalizeAvatarUpload } from '@/src/server/media/avatar-storage.service';
import {
  auditSensitiveAccess,
  canViewSensitivePersonData,
} from '@/lib/privacy/sensitive-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const activeMatriculaStatuses: StatusMatricula[] = [
  StatusMatricula.ATIVA,
  StatusMatricula.PAUSADA,
  StatusMatricula.AGUARDANDO_CONFIRMACAO,
  StatusMatricula.PENDENTE_TAXA,
];

type AlunoDeletionBlockers = {
  activeMatriculas: number;
  activeSubscriptions: number;
  cobrancas: {
    pending: number;
    processing: number;
    overdue: number;
    paid: number;
  };
};

function hasDeletionBlockers(blockers: AlunoDeletionBlockers) {
  return (
    blockers.activeMatriculas > 0 ||
    blockers.activeSubscriptions > 0 ||
    blockers.cobrancas.pending > 0 ||
    blockers.cobrancas.processing > 0 ||
    blockers.cobrancas.overdue > 0 ||
    blockers.cobrancas.paid > 0
  );
}

async function getAlunoDeletionBlockers(params: {
  alunoId: string;
  contaId: string;
}): Promise<AlunoDeletionBlockers> {
  const { alunoId, contaId } = params;
  const cobrancaBaseWhere = { matricula: { alunoId, aluno: { contaId } } };
  const [
    activeMatriculas,
    activeSubscriptions,
    pendingCharges,
    processingCharges,
    overdueCharges,
    paidCharges,
  ] = await Promise.all([
    prisma.matricula.count({
      where: {
        alunoId,
        aluno: { contaId },
        status: { in: activeMatriculaStatuses },
      },
    }),
    prisma.subscription.count({
      where: {
        status: 'ACTIVE',
        matricula: { alunoId, aluno: { contaId } },
      },
    }),
    prisma.cobranca.count({
      where: {
        ...cobrancaBaseWhere,
        status: { in: [StatusCobranca.A_VENCER, StatusCobranca.PENDENTE] },
      },
    }),
    prisma.cobranca.count({
      where: {
        ...cobrancaBaseWhere,
        status: StatusCobranca.PROCESSANDO,
      },
    }),
    prisma.cobranca.count({
      where: {
        ...cobrancaBaseWhere,
        status: StatusCobranca.ATRASADO,
      },
    }),
    prisma.cobranca.count({
      where: {
        ...cobrancaBaseWhere,
        status: StatusCobranca.PAGO,
      },
    }),
  ]);

  return {
    activeMatriculas,
    activeSubscriptions,
    cobrancas: {
      pending: pendingCharges,
      processing: processingCharges,
      overdue: overdueCharges,
      paid: paidCharges,
    },
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; role?: string; contaId?: string } } | null)?.user;
    const contaId = user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!canViewSensitivePersonData({ user: user ?? {}, contaId, purpose: 'STUDENT_DETAIL' })) {
      return NextResponse.json({ error: 'Acesso negado a dados sensíveis do aluno.' }, { status: 403 });
    }

    const aluno = await getAluno(rawParams.id, contaId);
    if (!aluno) return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 });

    type GetAlunoResult = Awaited<ReturnType<typeof getAluno>>;
    type ResponsavelLink = NonNullable<GetAlunoResult>['responsaveis'] extends Array<infer T>
      ? T
      : never;

    // ✅ Transformar responsaveis (array) para responsavel (singular) para compatibilidade com frontend
    const responsavelFinanceiro = aluno.responsaveis?.find(
      (ar: ResponsavelLink) =>
        ar.responsavel.financeiro ||
        ar.tipoVinculo === 'FINANCEIRO' ||
        ar.tipoVinculo === 'PRINCIPAL',
    )?.responsavel;

    const alunoTransformado = {
      ...aluno,
      asaasCustomerId: aluno.asaasCustomerId ?? null,
      responsavel: responsavelFinanceiro
        ? {
            id: responsavelFinanceiro.id,
            nome: responsavelFinanceiro.nome,
            cpf: responsavelFinanceiro.cpf,
            email: responsavelFinanceiro.email,
            telefone: responsavelFinanceiro.telefone,
            endereco: {
              cep: responsavelFinanceiro.enderecoCep ?? null,
              logradouro: responsavelFinanceiro.enderecoLogradouro ?? null,
              numero: responsavelFinanceiro.enderecoNumero ?? null,
              complemento: responsavelFinanceiro.enderecoComplemento ?? null,
              bairro: responsavelFinanceiro.enderecoBairro ?? null,
              cidade: responsavelFinanceiro.enderecoCidade ?? null,
              uf: responsavelFinanceiro.enderecoUf ?? null,
            },
          }
        : null,
    };

    await auditSensitiveAccess({
      prisma,
      req,
      contaId,
      actorUserId: user?.id,
      action: 'student.sensitive.view',
      entityType: 'Aluno',
      entityId: aluno.id,
      purpose: 'STUDENT_DETAIL',
      metadata: {
        fields: ['cpf', 'email', 'telefone', 'responsavel.cpf', 'responsavel.email', 'responsavel.telefone'],
      },
    });

    return NextResponse.json(alunoDetailDTOSchema.parse(mapAlunoDetailToDTO(alunoTransformado)));
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao buscar aluno.' },
      { status: 400 },
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    // Obter contaId da sessão para sincronização com Asaas
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; role?: string; contaId?: string } } | null)?.user;
    const contaId = user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
    }

    if (!canViewSensitivePersonData({ user: user ?? {}, contaId, purpose: 'STUDENT_EDIT' })) {
      return NextResponse.json({ error: 'Acesso negado para alterar dados sensíveis do aluno.' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateAlunoInputDTOSchema.parse({ ...body, id: rawParams.id });

    const existing = await prisma.aluno.findFirst({
      where: { id: rawParams.id, contaId },
      select: { foto: true },
    });

    const normalizedFoto = await normalizeAvatarUpload({
      entity: 'aluno',
      entityId: rawParams.id,
      contaId,
      foto: parsed.foto,
      previousFoto: existing?.foto,
    });

    const aluno = await updateAluno({
      ...parsed,
      contaId,
      ...(normalizedFoto !== undefined ? { foto: normalizedFoto } : {}),
    });

    await auditSensitiveAccess({
      prisma,
      req,
      contaId,
      actorUserId: user?.id,
      action: 'student.sensitive.update',
      entityType: 'Aluno',
      entityId: rawParams.id,
      purpose: 'STUDENT_EDIT',
      metadata: {
        fields: Object.keys(body ?? {}).filter((field) =>
          ['cpf', 'email', 'telefone', 'dataNasc', 'endereco', 'restricoesMedicas', 'alergias'].includes(field),
        ),
      },
    });
    return NextResponse.json(alunoDetailDTOSchema.parse(mapAlunoDetailToDTO(aluno)));
  } catch (e: unknown) {
    const err = e as Partial<{
      issues: Array<{ path: string[]; message: string }>;
      code: string;
      meta: { target?: string[] };
    }>;
    if (err.issues && err.issues.length) {
      const first = err.issues[0];
      const field = first.path.join('.') || 'geral';
      return NextResponse.json(
        {
          error: `Erro de validação${field !== 'geral' ? ` no campo ${field}` : ''}: ${first.message}`,
          field,
          details: err.issues,
        },
        { status: 400 },
      );
    }
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 });
    }
    if (err.code === 'P2002') {
      const targets = (err.meta?.target || []) as string[];
      const key = targets.join('_');
      const map: Record<string, string> = {
        cpf: 'CPF já cadastrado.',
        email: 'Email já em uso nesta conta.',
        codigoInterno: 'Código interno já existe nesta conta.',
        contaId_email: 'Email já em uso nesta conta.',
        contaId_codigoInterno: 'Código interno já existe nesta conta.',
      };
      return NextResponse.json(
        { error: map[key] || 'Dados duplicados.', field: targets.join(', ') },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao atualizar.' },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  let contaId: string | undefined;
  let actorId: string | undefined;
  try {
    // Obter contaId da sessão para sincronização com gateway
    const session = await getServerSession(authOptions);
    contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId;
    actorId = (session as { user?: { id?: string } } | null)?.user?.id;

    if (!contaId) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
    }

    const url = new URL(req.url);
    const motivo = url.searchParams.get('motivo') || undefined;
    const forceDelete = url.searchParams.get('forceDelete') === 'true';

    // 1) Carregar aluno + matrículas para montar o plano
    const alunoData = await prisma.aluno.findFirst({
      where: { id: rawParams.id, contaId },
      select: { id: true, nome: true, status: true },
    });

    if (!alunoData) {
      return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
    }

    const matriculasData = await prisma.matricula.findMany({
      where: { alunoId: rawParams.id, aluno: { contaId } },
      select: { id: true, status: true, asaasSubscriptionId: true },
    });

    // 2) Montar plano puro (domínio)
    const plan = buildAlunoArchivePlan({
      aluno: { id: alunoData.id, nome: alunoData.nome, status: alunoData.status },
      matriculas: matriculasData.map((m) => ({
        id: m.id,
        status: m.status,
        asaasSubscriptionId: m.asaasSubscriptionId,
      })),
      contaId,
      motivo,
      actorId,
    });

    // 3) Executar no gateway (não abortar se falhar)
    let execution: AlunoArchiveExecutionResult;
    try {
      const paymentsProvider = await getPaymentsProviderForConta(contaId);
      execution = await executeAlunoArchivePlan(plan, { paymentsProvider });
    } catch (err) {
      console.error('[alunos][delete] Erro ao sincronizar com gateway:', err);
      execution = {
        alunoId: rawParams.id,
        ok: false,
        errors: [{ code: 'GATEWAY_SYNC_FAILED', message: 'Falha ao sincronizar com processador de pagamentos.' }],
        matriculaResults: [],
        impact: {
          matriculas: { cancelled: 0, errors: 0 },
          subscriptions: { deleted: 0, errors: 1 },
        },
      };

      await prisma.auditLog.create({
        data: {
          contaId,
          actorType: actorId ? 'USER' : 'SYSTEM',
          actorId: actorId ?? undefined,
          action: 'finance.aluno.archive.gateway_sync_failed',
          entityType: 'Aluno',
          entityId: rawParams.id,
          metadata: {
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          },
        },
      });
    }

    // 4) Aplicar operação local (arquivar/hard delete + customer safety)
    const alunoResult = await deleteAluno(rawParams.id, contaId, motivo, forceDelete, actorId);
    
    // 5) Calcular blockers depois (podem ter mudado)
    const blockers = await getAlunoDeletionBlockers({ alunoId: rawParams.id, contaId });
    const outcome = forceDelete
      ? (await prisma.aluno.findFirst({ where: { id: rawParams.id, contaId }, select: { id: true } }))
        ? 'ARCHIVED'
        : 'HARD_DELETED'
      : 'ARCHIVED';

    if (outcome === 'ARCHIVED' && hasDeletionBlockers(blockers)) {
      console.info('[alunos][delete] Arquivado com vínculos ativos', {
        alunoId: rawParams.id,
        contaId,
        blockers,
      });
    }

    // 6) Extrair resultado da inativação do customer (se disponível)
    const customerInactivation = (alunoResult as { _customerInactivation?: { action: string; reason?: string } })
      ._customerInactivation;
    
    // 7) Merge impact local + gateway
    const localImpact = (alunoResult as { _matriculasCanceladas?: { total: number; erros: number } })
      ._matriculasCanceladas;
    const impact = {
      matriculas: {
        cancelled: execution.impact.matriculas.cancelled + (localImpact?.total ?? 0),
        errors: execution.impact.matriculas.errors + (localImpact?.erros ?? 0),
      },
      subscriptions: {
        deleted: execution.impact.subscriptions.deleted,
        errors: execution.impact.subscriptions.errors,
      },
    };
    
    // Limpar campos internos antes de retornar
    const aluno = { ...alunoResult };
    delete (aluno as { _customerInactivation?: unknown })._customerInactivation;
    delete (aluno as { _matriculasCanceladas?: unknown })._matriculasCanceladas;

    return NextResponse.json(
      alunoDeleteResultDTOSchema.parse(
        mapAlunoDeleteResultToDTO({
          aluno,
          deletion: {
            outcome,
            blockers,
            customerInactivation: customerInactivation ?? undefined,
            impact,
            gatewaySync: {
              ok: execution.ok,
              errors: execution.errors,
            },
          },
        }),
      ),
    );
  } catch (e: unknown) {
    const err = e as Partial<{ code: string }>;
    if (e instanceof AsaasCustomerEnsureError) {
      const isConfigError = ['MISSING_KEY', 'DECRYPT_FAILED', 'INVALID_KEY'].includes(e.code);
      const providerStatus = e.providerStatus;
      const status =
        e.code === 'PAYER_INVALID'
          ? 400
          : e.code === 'ASAAS_ERROR' && providerStatus
            ? providerStatus
            : isConfigError
              ? 412
              : 503;
      const message =
        e.code === 'PAYER_INVALID'
          ? e.message
          : e.code === 'ASAAS_ERROR' && providerStatus && [400, 422].includes(providerStatus)
            ? e.message
            : isConfigError
              ? 'Conta de pagamentos não configurada.'
              : 'Serviço de pagamentos indisponível. Tente novamente.';
      return NextResponse.json({ error: message }, { status });
    }
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Registro não encontrado.', code: err.code }, { status: 404 });
    }
    if (err.code === 'ALUNO_NOT_FOUND') {
      return NextResponse.json({ error: 'Registro não encontrado.', code: err.code }, { status: 404 });
    }
    if (err.code === 'ALUNO_HAS_ACTIVE_DEPENDENCIES') {
      const errWithCounts = e as { activeMatriculas?: number; activeSubscriptions?: number };
      const blockers: AlunoDeletionBlockers = {
        activeMatriculas: errWithCounts.activeMatriculas ?? 0,
        activeSubscriptions: errWithCounts.activeSubscriptions ?? 0,
        cobrancas: {
          pending: 0,
          processing: 0,
          overdue: 0,
          paid: 0,
        },
      };
      console.warn('[alunos][delete] Bloqueado por dependências ativas', {
        alunoId: rawParams.id,
        contaId,
        blockers,
      });
      return NextResponse.json(
        {
          error: 'Aluno possui vínculos ativos. Confirme para cancelar e excluir.',
          code: err.code,
          activeMatriculas: blockers.activeMatriculas,
          activeSubscriptions: blockers.activeSubscriptions,
          blockers,
        },
        { status: 409 },
      );
    }
    // Fallback para códigos antigos (backward compatibility)
    if (err.code === 'ALUNO_HAS_ACTIVE_SUBSCRIPTIONS') {
      const blockers: AlunoDeletionBlockers = {
        activeMatriculas: 0,
        activeSubscriptions: 1,
        cobrancas: {
          pending: 0,
          processing: 0,
          overdue: 0,
          paid: 0,
        },
      };
      console.warn('[alunos][delete] Bloqueado por assinatura ativa', {
        alunoId: rawParams.id,
        contaId,
        blockers,
      });
      return NextResponse.json(
        {
          error: 'Aluno possui assinaturas ativas. Cancele as assinaturas antes de excluir.',
          code: err.code,
          activeSubscriptions: blockers.activeSubscriptions,
          activeMatriculas: blockers.activeMatriculas,
          blockers,
        },
        { status: 409 },
      );
    }
    if (err.code === 'ALUNO_HAS_ACTIVE_MATRICULAS') {
      const blockers: AlunoDeletionBlockers = {
        activeMatriculas: 1,
        activeSubscriptions: 0,
        cobrancas: {
          pending: 0,
          processing: 0,
          overdue: 0,
          paid: 0,
        },
      };
      console.warn('[alunos][delete] Bloqueado por matrícula ativa', {
        alunoId: rawParams.id,
        contaId,
        blockers,
      });
      return NextResponse.json(
        {
          error: 'Aluno possui matrículas ativas. Inative as matrículas antes de excluir.',
          code: err.code,
          activeMatriculas: blockers.activeMatriculas,
          activeSubscriptions: blockers.activeSubscriptions,
          blockers,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao excluir.' },
      { status: 400 },
    );
  }
}
