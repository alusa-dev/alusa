/**
 * API Route: Confirmar Recebimento Manual de Cobrança
 *
 * POST /api/cobrancas/[id]/confirmar-recebimento
 *
 * Permite que um gestor confirme manualmente o recebimento de uma cobrança
 * (pagamento em dinheiro, transferência, Pix externo, etc.) e sincroniza
 * com o Asaas se a cobrança tiver asaasPaymentId.
 *
 * Fluxo:
 * 1. Valida autenticação e permissões (ADMIN, FINANCEIRO)
 * 2. Busca cobrança no banco
 * 3. Valida se pode dar baixa (status PENDENTE)
 * 4. Se tem asaasPaymentId, chama API Asaas (POST /payments/{id}/receiveInCash)
 * 5. Atualiza status local para PAGO
 * 6. Registra log de auditoria
 * 7. Atualiza status financeiro da matrícula
 * 8. Retorna 200 OK
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { StatusCobranca } from '@prisma/client';
import {
  AsaasEnvError,
  KycNotApprovedError,
  confirmCashPayment,
  getCurrentBrasiliaDate,
  isAsaasEnabled,
  readPaymentStatusPreflight,
  auditLogService,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import {
  cobrancaActionResultDTOSchema,
  cobrancaConfirmarRecebimentoInputDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cobrancaId } = cobrancaRouteParamsDTOSchema.parse(await params);

    // Parse do body
    const parsedBody = cobrancaConfirmarRecebimentoInputDTOSchema.safeParse(
      await req.json().catch(() => ({})),
    );
    if (!parsedBody.success) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido');
    }
    const body = parsedBody.data;

    // Autenticação e autorização
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: { id: string; role?: string } } | null)?.user ?? null;

    if (!user?.id) {
      return jsonError(403, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!user.role || !allowedRoles.has(String(user.role).toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        `Usuário com papel "${user.role}" não tem permissão para confirmar recebimentos.`,
      );
    }

    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId;
    if (!contaId) {
      return jsonError(400, 'CONTA_INVALIDA', 'Conta não identificada');
    }

    // Buscar cobrança - MULTI-TENANT
    const cobranca = await prisma.cobranca.findFirst({
      where: { id: cobrancaId, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: { select: { id: true, nome: true, contaId: true } },
          },
        },
      },
    });

    const charge = !cobranca
      ? await prisma.charge.findFirst({
          where: { id: cobrancaId, contaId },
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            value: true,
            customerId: true,
          },
        })
      : null;

    if (!cobranca && !charge) {
      return jsonError(404, 'COBRANCA_NAO_ENCONTRADA', 'Cobrança não encontrada');
    }

    if (cobranca) {
      // Validar se pode dar baixa (aceita PENDENTE ou A_VENCER)
      const statusPermitidos: StatusCobranca[] = [
        StatusCobranca.PENDENTE,
        StatusCobranca.A_VENCER,
        StatusCobranca.ATRASADO,
      ];
      if (!statusPermitidos.includes(cobranca.status)) {
        return jsonError(
          400,
          'STATUS_INVALIDO',
          `Cobrança com status "${cobranca.status}" não pode receber baixa manual. Apenas cobranças pendentes ou a vencer podem ser confirmadas.`,
        );
      }
    } else if (charge) {
      const statusPermitidosCharge = new Set(['CREATED', 'OPEN', 'OVERDUE']);
      if (!statusPermitidosCharge.has(charge.status)) {
        return jsonError(
          400,
          'STATUS_INVALIDO',
          `Cobrança com status "${charge.status}" não pode receber baixa manual.`,
        );
      }
    }

    // ✅ Obter data atual no timezone de Brasília (timezone-safe)
    const brasiliaDate = getCurrentBrasiliaDate();
    
    const isValidDate = (value?: string): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const dataPagamentoStr: string = isValidDate(body.dataPagamento) ? body.dataPagamento : brasiliaDate.dateStr;
    const dataPagamentoDate = isValidDate(body.dataPagamento)
      ? new Date(body.dataPagamento + 'T12:00:00.000Z')
      : brasiliaDate.dateObj;
    const formaPagamentoManual = body.formaPagamentoManual ?? 'DINHEIRO';
    const observacao = body.observacao ?? 'Confirmação manual de recebimento';
    const notifyCustomer = typeof body.notifyCustomer === 'boolean' ? body.notifyCustomer : undefined;

    console.log('[Confirmar Recebimento] Dados recebidos:', {
      cobrancaId,
      dataPagamentoStr,
      dataPagamentoDate,
      formaPagamentoManual,
      brasiliaCurrentDate: brasiliaDate.dateStr,
      brasiliaDateComponents: { year: brasiliaDate.year, month: brasiliaDate.month, day: brasiliaDate.day },
    });

    // Se tem asaasPaymentId, sincronizar com Asaas

    if (!isAsaasEnabled()) {
      return jsonError(503, 'ASAAS_INDISPONIVEL', 'Integração Asaas desabilitada');
    }

    const asaasPaymentId = cobranca?.asaasPaymentId ?? charge?.asaasPaymentId ?? null;
    if (!asaasPaymentId) {
      return jsonError(400, 'ASAAS_PAYMENT_ID_AUSENTE', 'Cobrança sem integração Asaas');
    }

    const asaasPayment = await readPaymentStatusPreflight(asaasPaymentId, { contaId });

    if (asaasPayment.status === 'RECEIVED_IN_CASH') {
      await auditLogService.record({
        contaId,
        action: 'finance.manual.cash_payment_idempotent',
        actor: { type: 'USER', id: user.id },
        entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
        metadata: {
          type: 'CASH_RECEIVED',
          origin: 'MANUAL',
          auditUserId: user.id,
          occurredAt: dataPagamentoDate.toISOString(),
          valor: Number(cobranca?.valor ?? charge?.value ?? 0),
          formaPagamentoManual,
          observacao,
          asaasPaymentId,
          asaasStatus: asaasPayment.status,
          matriculaId: cobranca?.matriculaId ?? null,
          notifyCustomer,
        },
      });

      return NextResponse.json(
        cobrancaActionResultDTOSchema.parse(
          mapCobrancaActionResultToDTO({
            success: true,
            pending: false,
            alreadyReceived: true,
            message: 'Cobrança já confirmada como recebida em dinheiro na plataforma financeira.',
          }),
        ),
      );
    }

    const allowedStatuses = new Set(['PENDING', 'OVERDUE']);
    if (!allowedStatuses.has(asaasPayment.status)) {
      return jsonError(
        409,
        'STATUS_INVALIDO_ASAAS',
        `Operação não permitida. Status atual no Asaas: ${asaasPayment.status}`,
      );
    }

    try {
      await confirmCashPayment(
        asaasPaymentId,
        dataPagamentoStr,
        Number(cobranca?.valor ?? charge?.value ?? 0),
        notifyCustomer,
        { contaId },
      );
    } catch (error) {
      if (error instanceof KycNotApprovedError) {
        return jsonError(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
      }
      if (error instanceof AsaasEnvError) {
        return jsonError(503, 'ASAAS_INDISPONIVEL', 'Credenciais Asaas não configuradas');
      }
      throw error;
    }

    // Registrar evento financeiro formal (Confirmação Manual)
    await auditLogService.record({
      contaId,
      action: 'finance.manual.cash_payment_confirmed',
      actor: { type: 'USER', id: user.id },
      entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
      metadata: {
        type: 'CASH_RECEIVED',
        origin: 'MANUAL',
        auditUserId: user.id,
        occurredAt: dataPagamentoDate.toISOString(),
        valor: Number(cobranca?.valor ?? charge?.value ?? 0),
        formaPagamentoManual,
        observacao,
        asaasSynced: true,
        asaasPaymentId,
        statusAnterior: cobranca?.status ?? charge?.status ?? null,
        statusNovo: 'PAGO',
        matriculaId: cobranca?.matriculaId ?? null,
        notifyCustomer,
      },
    });

    await prisma.logFinanceiro.create({
      data: {
        contaId,
        usuarioId: user.id,
        cobrancaId: cobranca?.id ?? null,
        acao: 'CONFIRMAR_RECEBIMENTO_DINHEIRO',
        detalhes: {
          entityType: cobranca ? 'COBRANCA' : 'CHARGE',
          cobrancaId,
          asaasPaymentId,
          dataPagamento: dataPagamentoDate.toISOString(),
          dataPagamentoStr,
          formaPagamentoManual,
          observacao,
          notifyCustomer,
        },
      },
    });

    if (cobranca?.matriculaId) {
      // Registrar log de auditoria acadêmica apenas quando existe matrícula associada
      const actorExists = await prisma.usuario.findUnique({
        where: { id: user.id },
        select: { id: true },
      });

      await prisma.matriculaLog.create({
        data: {
          matriculaId: cobranca.matriculaId,
          action: 'COBRANCA_RECEBIMENTO_SOLICITADO',
          actorId: actorExists?.id ?? null,
          metadata: {
            cobrancaId: cobranca.id,
            valor: Number(cobranca.valor),
            dataPagamento: dataPagamentoDate.toISOString(),
            dataPagamentoStr,
            formaPagamentoManual,
            observacao,
            asaasSynced: true,
            asaasPaymentId,
            confirmedBy: user.id,
            confirmedByRole: user.role,
            actorIdFallback: actorExists ? null : user.id,
            notifyCustomer,
          },
        },
      });
    }

    try {
      const syncResult = await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId,
      });

      void syncResult;
    } catch (syncError) {
      console.warn('[Confirmar Recebimento] Falha ao sincronizar estado pós-comando', {
        cobrancaId,
        asaasPaymentId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    console.log('[Confirmar Recebimento] Solicitação enviada ao Asaas:', {
      cobrancaId,
      matriculaId: cobranca?.matriculaId ?? null,
    });

    return NextResponse.json(
      cobrancaActionResultDTOSchema.parse(
        mapCobrancaActionResultToDTO({
          success: true,
          pending: true,
          message: 'Solicitação enviada. O status será atualizado automaticamente em instantes.',
        }),
      ),
      { status: 202 },
    );
  } catch (error) {
    console.error('[Confirmar Recebimento] Erro:', error);
    const message = error instanceof Error ? error.message : 'Erro interno';
    return jsonError(500, 'ERRO_INTERNO', message);
  }
}
