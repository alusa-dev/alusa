import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { FORMA_PAGAMENTO_TO_ASAAS } from '@alusa/finance';
import {
  AsaasEnvError,
  KycNotApprovedError,
  isAsaasEnabled,
  readPaymentFullPreflight,
  updatePayment,
} from '@alusa/finance';
import type { AsaasCreatePaymentInput } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import {
  cobrancaRouteParamsDTOSchema,
  cobrancaUpdateFormaPagamentoInputDTOSchema,
  cobrancaUpdateFormaPagamentoResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaUpdateFormaPagamentoResultToDTO } from '@/features/financeiro/cobrancas/mappers';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const ASAAS_EDITABLE_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_PAID_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const LOCAL_EDITABLE_COBRANCA_STATUSES = new Set(['PENDENTE', 'A_VENCER', 'ATRASADO']);
const LOCAL_EDITABLE_CHARGE_STATUSES = new Set(['CREATED', 'OPEN', 'OVERDUE']);

function mutationError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      success: false,
      code,
      error: message,
      ...extra,
    },
    { status },
  );
}

/**
 * PUT /api/cobrancas/[id]/forma-pagamento
 * Atualiza a forma de pagamento de uma cobrança e sincroniza com o Asaas
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    // Removido: logs de variáveis sensíveis de ambiente
    const { id } = cobrancaRouteParamsDTOSchema.parse(rawParams);
    const body = await req.json();
    const parsedBody = cobrancaUpdateFormaPagamentoInputDTOSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: 'Forma de pagamento é obrigatória' },
        { status: 400 },
      );
    }
    const { formaPagamento } = parsedBody.data;

    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Usuário não autenticado' },
        { status: 401 },
      );
    }

    const role = String(user.role ?? '').toUpperCase();
    if (!allowedRoles.has(role)) {
      return NextResponse.json(
        { success: false, error: 'Usuário sem permissão para alterar forma de pagamento' },
        { status: 403 },
      );
    }

    const contaId = user.contaId;
    if (!contaId) {
      return NextResponse.json(
        { success: false, error: 'Conta não identificada' },
        { status: 400 },
      );
    }

    // Buscar cobrança acadêmica - MULTI-TENANT
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: true,
          },
        },
      },
    });

    const standaloneCharge = !cobranca
      ? await prisma.charge.findFirst({
          where: { id, contaId },
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            value: true,
            dueDate: true,
            billingType: true,
            invoiceUrl: true,
          },
        })
      : null;

    if (!cobranca && !standaloneCharge) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    if (standaloneCharge) {
      if (!LOCAL_EDITABLE_CHARGE_STATUSES.has(String(standaloneCharge.status))) {
        return mutationError(
          String(standaloneCharge.status) === 'PAID' ? 409 : 400,
          String(standaloneCharge.status) === 'PAID'
            ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE'
            : 'EDIT_NOT_ALLOWED_FOR_CHARGE_STATUS',
          `Apenas cobranças em aberto podem ter a forma de pagamento alterada. Status atual: ${standaloneCharge.status}`,
          { status: standaloneCharge.status },
        );
      }

      if (!standaloneCharge.asaasPaymentId) {
        return NextResponse.json(
          {
            success: false,
            error: 'Cobrança não possui ID do Asaas. Não é possível sincronizar.',
          },
          { status: 400 },
        );
      }

      if (!isAsaasEnabled()) {
        return NextResponse.json(
          {
            success: false,
            error: 'Integração com Asaas desabilitada. Ative FEATURE_ASAAS para sincronizar.',
          },
          { status: 503 },
        );
      }

      const billingType =
        FORMA_PAGAMENTO_TO_ASAAS[formaPagamento as keyof typeof FORMA_PAGAMENTO_TO_ASAAS] as AsaasCreatePaymentInput['billingType'] | undefined;

      if (!billingType) {
        return NextResponse.json(
          {
            success: false,
            error: `Forma de pagamento inválida: ${formaPagamento}`,
          },
          { status: 400 },
        );
      }

      let asaasData: Awaited<ReturnType<typeof updatePayment>>;
      try {
        const currentPayment = await readPaymentFullPreflight(standaloneCharge.asaasPaymentId, { contaId });

        if (!ASAAS_EDITABLE_PAYMENT_STATUSES.has(currentPayment.status)) {
          return mutationError(
            ASAAS_PAID_PAYMENT_STATUSES.has(currentPayment.status) ? 409 : 400,
            ASAAS_PAID_PAYMENT_STATUSES.has(currentPayment.status)
              ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE'
              : 'EDIT_NOT_ALLOWED_FOR_CHARGE_STATUS',
            `Não é possível editar cobrança com status ${currentPayment.status} no Asaas`,
            { asaasStatus: currentPayment.status },
          );
        }

        const payload: Partial<AsaasCreatePaymentInput> = {
          billingType,
          value: Number(currentPayment.value ?? standaloneCharge.value ?? 0),
          dueDate: currentPayment.dueDate ?? standaloneCharge.dueDate?.toISOString().slice(0, 10),
        };

        asaasData = await updatePayment(standaloneCharge.asaasPaymentId, payload, { contaId });
      } catch (error) {
        if (error instanceof KycNotApprovedError) {
          return NextResponse.json(
            { success: false, error: 'KYC_NAO_APROVADO' },
            { status: 409 },
          );
        }
        if (error instanceof AsaasEnvError) {
          console.error('[PUT forma-pagamento] Configuração Asaas inválida:', error.message);
          return NextResponse.json(
            {
              success: false,
              error: error.message,
            },
            { status: 500 },
          );
        }

        console.error('[PUT forma-pagamento] Erro ao atualizar Charge no Asaas:', error);

        return NextResponse.json(
          {
            success: false,
            error: 'Erro ao sincronizar com Asaas',
            details: {
              paymentId: standaloneCharge.asaasPaymentId,
              billingType,
            },
          },
          { status: 500 },
        );
      }

      const chargeAtualizada = await prisma.charge.update({
        where: { id: standaloneCharge.id },
        data: {
          billingType,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json(
        cobrancaUpdateFormaPagamentoResultDTOSchema.parse(
          mapCobrancaUpdateFormaPagamentoResultToDTO({
            success: true,
            message:
              'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
            data: {
              cobranca: chargeAtualizada,
              asaasData,
            },
          }),
        ),
        { status: 202 },
      );
    }

    const academicCobranca = cobranca;
    if (!academicCobranca) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    // Validar se a cobrança está pendente
    if (!LOCAL_EDITABLE_COBRANCA_STATUSES.has(String(academicCobranca.status))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Apenas cobranças em aberto podem ter a forma de pagamento alterada',
        },
        { status: 400 },
      );
    }

    // Validar se tem asaasPaymentId
    if (!academicCobranca.asaasPaymentId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cobrança não possui ID do Asaas. Não é possível sincronizar.',
        },
        { status: 400 },
      );
    }

    if (!isAsaasEnabled()) {
      console.warn('[PUT forma-pagamento] Integração Asaas desabilitada');
      return NextResponse.json(
        {
          success: false,
          error: 'Integração com Asaas desabilitada. Ative FEATURE_ASAAS para sincronizar.',
        },
        { status: 503 },
      );
    }

    // O DTO já normaliza aliases legados para o enum persistido.
    const formaPagamentoKey = formaPagamento;
    const billingType =
      FORMA_PAGAMENTO_TO_ASAAS[formaPagamentoKey as keyof typeof FORMA_PAGAMENTO_TO_ASAAS] as AsaasCreatePaymentInput['billingType'] | undefined;

    if (!billingType) {
      return NextResponse.json(
        {
          success: false,
          error: `Forma de pagamento inválida: ${formaPagamento}`,
        },
        { status: 400 },
      );
    }

    let asaasData: Awaited<ReturnType<typeof updatePayment>>;
    try {
      const contaId = academicCobranca.matricula.aluno?.contaId;
      if (!contaId) {
        return NextResponse.json(
          { success: false, error: 'Aluno não possui conta vinculada. Não é possível sincronizar com Asaas.' },
          { status: 400 },
        );
      }
      const currentPayment = await readPaymentFullPreflight(academicCobranca.asaasPaymentId, { contaId });

      if (!ASAAS_EDITABLE_PAYMENT_STATUSES.has(currentPayment.status)) {
        return mutationError(
          ASAAS_PAID_PAYMENT_STATUSES.has(currentPayment.status) ? 409 : 400,
          ASAAS_PAID_PAYMENT_STATUSES.has(currentPayment.status)
            ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE'
            : 'EDIT_NOT_ALLOWED_FOR_CHARGE_STATUS',
          `Não é possível editar cobrança com status ${currentPayment.status} no Asaas`,
          { asaasStatus: currentPayment.status },
        );
      }

      const payload: Partial<AsaasCreatePaymentInput> = {
        billingType,
        value: Number(currentPayment.value ?? academicCobranca.valor),
        dueDate: currentPayment.dueDate ?? academicCobranca.vencimento.toISOString().slice(0, 10),
      };

      asaasData = await updatePayment(academicCobranca.asaasPaymentId, payload, { contaId });
    } catch (error) {
      if (error instanceof KycNotApprovedError) {
        return NextResponse.json(
          { success: false, error: 'KYC_NAO_APROVADO' },
          { status: 409 },
        );
      }
      if (error instanceof AsaasEnvError) {
        console.error('[PUT forma-pagamento] Configuração Asaas inválida:', error.message);
        return NextResponse.json(
          {
            success: false,
            error: error.message,
          },
          { status: 500 },
        );
      }

      console.error('[PUT forma-pagamento] Erro ao atualizar no Asaas:', error);

      return NextResponse.json(
        {
          success: false,
          error: 'Erro ao sincronizar com Asaas',
          details: {
            paymentId: academicCobranca.asaasPaymentId,
            billingType,
          },
        },
        { status: 500 },
      );
    }
    // Buscar contaId da matrícula através do aluno
    const matricula = await prisma.matricula.findUnique({
      where: { id: academicCobranca.matriculaId },
      include: {
        aluno: {
          select: { contaId: true },
        },
      },
    });

    if (!matricula) {
      return NextResponse.json(
        { success: false, error: 'Matrícula não encontrada' },
        { status: 404 },
      );
    }

    const logContaId = matricula.aluno.contaId ?? user.contaId ?? undefined;

    if (!logContaId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Aluno não possui conta vinculada. Não é possível registrar log financeiro.',
        },
        { status: 400 },
      );
    }

    // Atualizar no banco local
    const cobrancaAtualizada = await prisma.cobranca.update({
      where: { id },
      data: {
        formaPagamento,
        updatedAt: new Date(),
      },
    });

    // Registrar log de alteração
    await prisma.logFinanceiro.create({
      data: {
        contaId: logContaId,
        usuarioId: user.id,
        cobrancaId: id,
        acao: 'FORMA_PAGAMENTO_ALTERADA',
        detalhes: {
          formaAnterior: academicCobranca.formaPagamento,
          formaNova: formaPagamento,
          billingTypeAsaas: billingType,
          asaasPaymentId: academicCobranca.asaasPaymentId,
          dataAlteracao: new Date().toISOString(),
        },
      },
    });

    return NextResponse.json(
      cobrancaUpdateFormaPagamentoResultDTOSchema.parse(
        mapCobrancaUpdateFormaPagamentoResultToDTO({
          success: true,
          message:
            'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
          data: {
            cobranca: cobrancaAtualizada,
            asaasData,
          },
        }),
      ),
      { status: 202 },
    );
  } catch (error) {
    console.error('[PUT forma-pagamento] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 },
    );
  }
}
