import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { createAsaasPayment, formatDate, getAsaasPaymentDetails, KycNotApprovedError, mapAsaasPaymentStatusToCobranca } from '@alusa/finance';
import { ensureAsaasCustomerForPayer } from '@alusa/lib';
import { StatusCobranca } from '@prisma/client';
import { calcIdade } from '@alusa/lib';
import {
  matriculaReenviarCobrancaResultDTOSchema,
  matriculaRouteParamsDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaReenviarCobrancaResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { materializeSubscriptionPaymentForCharge } from '@/src/server/matriculas/subscription-payment-materialization';

export const dynamic = 'force-dynamic';

/**
 * POST /api/matriculas/[id]/reenviar-cobranca
 * Obtém (e se necessário cria) cobrança via Asaas e retorna links oficiais (invoiceUrl/boleto/PIX)
 *
 * @description
 * - Para BOLETO/PIX/CARTAO: obtém (GET) ou cria (POST) o payment e retorna invoiceUrl
 * - Atualiza status da cobrança no banco local
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string; role?: string } })?.user;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id: matriculaId } = matriculaRouteParamsDTOSchema.parse(params);

    // Busca a matrícula e suas cobranças pendentes
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: user.contaId },
      },
      select: {
        id: true,
        taxaIsenta: true,
        taxaMatricula: true,
        dataInicio: true,
        asaasSubscriptionId: true,
        cobrancas: {
          where: {
            status: {
              in: [StatusCobranca.PENDENTE, StatusCobranca.A_VENCER, StatusCobranca.ATRASADO],
            },
          },
          orderBy: { vencimento: 'asc' },
          take: 1,
        },
        aluno: {
          select: {
            id: true,
            nome: true,
            email: true,
            cpf: true,
            telefone: true,
            dataNasc: true,
            asaasCustomerId: true,
            responsaveis: {
              select: {
                responsavel: {
                  select: {
                    id: true,
                    nome: true,
                    cpf: true,
                    email: true,
                    telefone: true,
                    financeiro: true,
                    asaasCustomerId: true,
                  },
                },
              },
            },
          },
        },
        responsavelFinanceiro: {
          select: {
            id: true,
            nome: true,
            cpf: true,
            email: true,
            telefone: true,
            financeiro: true,
            asaasCustomerId: true,
          },
        },
      },
    });

    if (!matricula) {
      return NextResponse.json({ error: 'Matrícula não encontrada' }, { status: 404 });
    }

    const cobranca = matricula.cobrancas[0];

    if (!cobranca) {
      return NextResponse.json({ error: 'Nenhuma cobrança pendente encontrada' }, { status: 404 });
    }

    // 🎯 FLUXO 1: Cobrança já tem asaasPaymentId → BUSCAR via Asaas
    if (cobranca.asaasPaymentId) {
      console.log(`[Reenviar Cobrança] Buscando payment ${cobranca.asaasPaymentId} via Asaas`);

      try {
        const { payment: paymentAtualizado, pixQrCode } = await getAsaasPaymentDetails({
          paymentId: cobranca.asaasPaymentId,
          contaId: user.contaId,
          includePixQrCode: true,
        });

        // Atualizar status local caso tenha mudado (usando mapper centralizado)
        if (paymentAtualizado.status) {
          const novoStatus = mapAsaasPaymentStatusToCobranca(paymentAtualizado.status, {
            dueDate: cobranca.vencimento,
          });

          await prisma.cobranca.update({
            where: { id: cobranca.id },
            data: { status: novoStatus, updatedAt: new Date() },
          });
        }

        return NextResponse.json(
          matriculaReenviarCobrancaResultDTOSchema.parse(
            mapMatriculaReenviarCobrancaResultToDTO({
              success: true,
              message: 'Link de cobrança obtido com sucesso',
              asaasPaymentId: cobranca.asaasPaymentId,
              status: paymentAtualizado.status,
              invoiceUrl: paymentAtualizado.invoiceUrl,
              bankSlipUrl: paymentAtualizado.bankSlipUrl,
              pixQrCodeUrl: pixQrCode?.encodedImage
                ? `data:image/png;base64,${pixQrCode.encodedImage}`
                : null,
              pixCopyPaste: pixQrCode?.payload || null,
            }),
          ),
        );
      } catch (error) {
        console.error('[Reenviar Cobrança] Erro ao buscar via Asaas:', error);
        return NextResponse.json(
          {
            error: 'Erro ao buscar cobrança via Asaas',
            details: (error as Error).message,
          },
          { status: 500 },
        );
      }
    }

    // 🎯 FLUXO 2: Cobrança SEM asaasPaymentId → CRIAR cobrança no Asaas
    if (!cobranca.asaasPaymentId) {
      if (cobranca.tipo === 'MENSALIDADE' && matricula.asaasSubscriptionId) {
        const materializedPayment = await materializeSubscriptionPaymentForCharge({
          prisma,
          contaId: user.contaId,
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          cobranca: {
            id: cobranca.id,
            vencimento: cobranca.vencimento,
            asaasPaymentId: cobranca.asaasPaymentId,
          },
          intent: 'MANUAL_REPAIR',
        });

        if (!materializedPayment.found) {
          return NextResponse.json(
            {
              error: 'ASSINATURA_PENDENTE_SINCRONIZACAO',
              message:
                'A assinatura já existe, mas o payment deste ciclo ainda não foi materializado pelo Asaas. Aguarde a sincronização automática e tente novamente.',
            },
            { status: 409 },
          );
        }

        if (!materializedPayment.payment) {
          return NextResponse.json(
            {
              error: 'ASSINATURA_PENDENTE_SINCRONIZACAO',
              message:
                'A assinatura já existe, mas o payment deste ciclo ainda não pôde ser resolvido localmente. Tente novamente após a sincronização.',
            },
            { status: 409 },
          );
        }

        const { payment, pixQrCode } = await getAsaasPaymentDetails({
          paymentId: materializedPayment.payment.id,
          contaId: user.contaId,
          includePixQrCode: cobranca.formaPagamento === 'PIX',
        });

        return NextResponse.json(
          matriculaReenviarCobrancaResultDTOSchema.parse(
            mapMatriculaReenviarCobrancaResultToDTO({
              success: true,
              message: 'Cobrança recorrente sincronizada com sucesso',
              asaasPaymentId: payment.id,
              status: payment.status,
              invoiceUrl: payment.invoiceUrl,
              bankSlipUrl: payment.bankSlipUrl,
              pixQrCodeUrl: pixQrCode?.encodedImage
                ? `data:image/png;base64,${pixQrCode.encodedImage}`
                : null,
              pixCopyPaste: pixQrCode?.payload || null,
            }),
          ),
        );
      }

      console.log('[Reenviar Cobrança] Criando payment no Asaas pela primeira vez');

      try {
        // Obter ou criar customer
        const aluno = matricula.aluno;
        const idade = calcIdade(aluno.dataNasc);
        const isMaiorDeIdade = idade >= 18;
        const responsavel =
          isMaiorDeIdade
            ? null
            : matricula.responsavelFinanceiro ||
              aluno.responsaveis.find((rel) => rel.responsavel.financeiro)?.responsavel ||
              aluno.responsaveis[0]?.responsavel ||
              null;

        const pagador = isMaiorDeIdade ? aluno : responsavel;

        if (!pagador) {
          return NextResponse.json(
            { error: 'Aluno menor de idade sem responsável financeiro cadastrado' },
            { status: 400 },
          );
        }

        if (!pagador.cpf) {
          return NextResponse.json({ error: 'CPF do pagador não encontrado' }, { status: 400 });
        }

        let customerId = pagador.asaasCustomerId;

        if (!customerId) {
          const createdCustomer = await ensureAsaasCustomerForPayer({
            contaId: user.contaId,
            payer: {
              type: isMaiorDeIdade ? 'ALUNO' : 'RESPONSAVEL',
              id: pagador.id,
              name: pagador.nome || (isMaiorDeIdade ? 'Aluno' : 'Responsável'),
              cpfCnpj: pagador.cpf,
              email: pagador.email || undefined,
              phone: pagador.telefone || undefined,
              mobilePhone: pagador.telefone || undefined,
            },
            persist: true,
          });

          if (!createdCustomer.ok) {
            return NextResponse.json({ error: createdCustomer.message }, { status: 500 });
          }

          customerId = createdCustomer.customerId;
        }

        const billingType =
          cobranca.formaPagamento === 'PIX'
            ? 'PIX'
            : cobranca.formaPagamento === 'CARTAO_CREDITO'
              ? 'CREDIT_CARD'
              : 'BOLETO';

        const createdPayment = await createAsaasPayment({
          contaId: user.contaId,
          customer: customerId!,
          billingType,
          value: Number(cobranca.valor),
          dueDate: formatDate(cobranca.vencimento),
          description: cobranca.descricao || undefined,
          externalReference: cobranca.id,
        });

        if (!createdPayment.success) {
          if (createdPayment.error === 'KYC_NAO_APROVADO') {
            return NextResponse.json(
              { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
              { status: 409 },
            );
          }

          return NextResponse.json({ error: createdPayment.error }, { status: 500 });
        }

        const { payment, pixQrCode } = await getAsaasPaymentDetails({
          paymentId: createdPayment.data.id,
          contaId: user.contaId,
          includePixQrCode: billingType === 'PIX',
        });

        await prisma.cobranca.update({
          where: { id: cobranca.id },
          data: { asaasPaymentId: payment.id, updatedAt: new Date() },
        });

        return NextResponse.json(
          matriculaReenviarCobrancaResultDTOSchema.parse(
            mapMatriculaReenviarCobrancaResultToDTO({
              success: true,
              message: 'Cobrança obtida do Asaas com sucesso',
              asaasPaymentId: payment.id,
              invoiceUrl: payment.invoiceUrl,
              bankSlipUrl: payment.bankSlipUrl,
              pixQrCodeUrl: pixQrCode?.encodedImage
                ? `data:image/png;base64,${pixQrCode.encodedImage}`
                : null,
              pixCopyPaste: pixQrCode?.payload || null,
            }),
          ),
        );
      } catch (error) {
        if (error instanceof KycNotApprovedError) {
          return NextResponse.json(
            { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
            { status: 409 },
          );
        }

        console.error('[Reenviar Cobrança] Erro ao criar payment no Asaas:', error);
        return NextResponse.json(
          {
            error: 'Erro ao criar cobrança no Asaas',
            details: (error as Error).message,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      {
        error: 'FORMA_PAGAMENTO_NAO_SUPORTADA',
        details: `Forma de pagamento não suportada para criação de cobrança: ${String(cobranca.formaPagamento)}`,
      },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
        { status: 409 },
      );
    }

    console.error('[API] Erro ao reenviar cobrança:', error);
    return NextResponse.json(
      {
        error: 'Erro interno ao reenviar cobrança',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
