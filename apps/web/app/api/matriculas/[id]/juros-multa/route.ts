import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { KycNotApprovedError, updateSubscription } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import { updateMatriculaJurosMultaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionTermsUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string | null;
  contaId?: string | null;
};

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUser = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = sessionUser?.contaId || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true };
  }
  return { contaId: requested || sessionContaId, mismatch: false };
}

async function resolveSessionUser() {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * PUT /api/matriculas/[id]/juros-multa
 * Atualiza juros e multa da assinatura no Asaas
 */
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionUser = await resolveSessionUser();
    console.log('🟡 [BACKEND] Recebendo requisição PUT /api/matriculas/[id]/juros-multa');
    console.log('🟡 [BACKEND] Matrícula ID:', ctx.params.id);
    
    const json = await req.json().catch(() => null);
    console.log('🟡 [BACKEND] Body recebido:', JSON.stringify(json, null, 2));

    const parsedBody = updateMatriculaJurosMultaInputDTOSchema.safeParse(json);
    if (!parsedBody.success) {
      console.error('🔴 [BACKEND] Payload inválido');
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsedBody.error.issues[0]?.message ?? 'Payload inválido',
        parsedBody.error.issues,
      );
    }

    const contaCtx = await resolveContaId(parsedBody.data.contaId ?? null);
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!contaCtx.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }

    const matriculaId = ctx.params.id;
    const { interest, fine, discount } = parsedBody.data;

    // Buscar matrícula
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: contaCtx.contaId },
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
      },
    });

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    if (!matricula.asaasSubscriptionId) {
      return jsonError(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
    }

    console.log('🟡 [BACKEND] Atualizando juros, multa e desconto da assinatura:', {
      subscriptionId: matricula.asaasSubscriptionId,
      interest,
      fine,
      discount,
    });

    const localSubscription = await prisma.subscription.findFirst({
      where: {
        contaId: contaCtx.contaId,
        matriculaId: matricula.id,
      },
      select: {
        status: true,
      },
    });

    if (localSubscription?.status === 'DELETED' || localSubscription?.status === 'EXPIRED') {
      return jsonError(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
    }

    console.log('🟡 [BACKEND] Chamando updateSubscription no Asaas...');
    const asaasInterest = interest ? { value: interest.value as number } : undefined;
    const asaasFine = fine ? { value: fine.value as number, type: fine.type } : undefined;
    const asaasDiscount = discount
      ? {
          value: discount.value,
          type: discount.type,
          dueDateLimitDays: discount.dueDateLimitDays,
        }
      : undefined;
    let asaasResponse;
    try {
      asaasResponse = await updateSubscription(matricula.asaasSubscriptionId, {
        interest: asaasInterest,
        fine: asaasFine,
        discount: asaasDiscount,
        updatePendingPayments: true,
      }, {
        contaId: contaCtx.contaId,
      });
    } catch (error) {
      const classified = classifyAsaasSubscriptionMutationError(error);
      if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
        return jsonError(
          409,
          'ASSINATURA_NAO_EDITAVEL',
          classified.providerMessage ?? 'O vínculo recorrente não pode ser atualizado no momento.',
        );
      }
      if (classified.kind === 'unauthorized') {
        return jsonError(
          502,
          'FINANCEIRO_AUTENTICACAO_INVALIDA',
          classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
        );
      }
      throw error;
    }
    console.log('🟢 [BACKEND] Resposta do Asaas:', JSON.stringify(asaasResponse, null, 2));

    console.log('🟢 [BACKEND] Juros, multa e desconto atualizados com sucesso no Asaas');

    // Atualizar no banco de dados local
    console.log('🟡 [BACKEND] Atualizando banco de dados local...');
    console.log('🟡 [BACKEND] Valores a serem salvos:', {
      jurosMensal: interest?.value,
      jurosTipo: interest?.type,
      multaPercentual: fine?.value,
      multaTipo: fine?.type,
      descontoAntecipado: discount?.value,
      descontoTipo: discount?.type,
      prazoDesconto: discount?.dueDateLimitDays,
    });
    
    const updatedMatricula = await prisma.matricula.update({
      where: { id: matriculaId },
      data: {
        jurosMensal: interest?.value ?? null,
        jurosTipo: interest?.type ?? null,
        multaPercentual: fine?.value ?? null,
        multaTipo: fine?.type ?? null,
        descontoAntecipado: discount && discount.value > 0 ? discount.value : null,
        descontoTipo: discount && discount.value > 0 ? discount.type ?? null : null,
        prazoDesconto: discount && discount.value > 0 ? discount.dueDateLimitDays ?? null : null,
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId,
        actorId: sessionUser?.id ?? 'system',
        action: 'MATRICULA_SUBSCRIPTION_TERMS_UPDATED',
        metadata: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          previousSubscriptionStatus: localSubscription?.status ?? 'UNKNOWN',
          interest,
          fine,
          discount: asaasDiscount ?? null,
          updatePendingPayments: true,
        },
      },
    });
    
    console.log('🟢 [BACKEND] Banco de dados atualizado:', {
      id: updatedMatricula.id,
      jurosMensal: updatedMatricula.jurosMensal,
      jurosTipo: updatedMatricula.jurosTipo,
      multaPercentual: updatedMatricula.multaPercentual,
      multaTipo: updatedMatricula.multaTipo,
      descontoAntecipado: updatedMatricula.descontoAntecipado,
      descontoTipo: updatedMatricula.descontoTipo,
      prazoDesconto: updatedMatricula.prazoDesconto,
    });
    
    // Verificar se realmente salvou
    const verificacao = await prisma.matricula.findUnique({
      where: { id: matriculaId },
      select: {
        id: true,
        jurosMensal: true,
        jurosTipo: true,
        multaPercentual: true,
        multaTipo: true,
        descontoAntecipado: true,
        descontoTipo: true,
        prazoDesconto: true,
      },
    });
    console.log('🔍 [BACKEND] Verificação após salvamento:', {
      jurosMensal: verificacao?.jurosMensal,
      jurosTipo: verificacao?.jurosTipo,
      multaPercentual: verificacao?.multaPercentual,
      multaTipo: verificacao?.multaTipo,
      descontoAntecipado: verificacao?.descontoAntecipado,
      descontoTipo: verificacao?.descontoTipo,
      prazoDesconto: verificacao?.prazoDesconto,
    });

    console.log('🟢 [BACKEND] Juros e multa atualizados no banco de dados local');

    const response = mapMatriculaSubscriptionTermsUpdateResultToDTO({
      interest,
      fine,
      discount,
      updated: {
        jurosMensal: updatedMatricula.jurosMensal ? Number(updatedMatricula.jurosMensal) : null,
        jurosTipo: updatedMatricula.jurosTipo ?? null,
        multaPercentual: updatedMatricula.multaPercentual ? Number(updatedMatricula.multaPercentual) : null,
        multaTipo: updatedMatricula.multaTipo ?? null,
        descontoAntecipado: updatedMatricula.descontoAntecipado
          ? Number(updatedMatricula.descontoAntecipado)
          : null,
        descontoTipo: updatedMatricula.descontoTipo ?? null,
        prazoDesconto: updatedMatricula.prazoDesconto ?? null,
      },
      message: 'Juros, multa e desconto atualizados com sucesso',
    });
    
    console.log('🟢 [BACKEND] Enviando resposta de sucesso:', JSON.stringify(response, null, 2));

    return NextResponse.json(response, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('🔴 [BACKEND] Erro ao atualizar juros e multa:', error);

    if (error instanceof KycNotApprovedError) {
      return jsonError(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }
    console.error('🔴 [BACKEND] Stack trace:', (error as Error).stack);
    return jsonError(500, 'ERRO_ATUALIZAR_JUROS_MULTA', (error as Error).message);
  }
}
