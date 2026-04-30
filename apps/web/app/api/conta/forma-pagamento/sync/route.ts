import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getPayment, getSubscription, recordAsaasReadIntent } from '@alusa/finance';
import prisma from '@/lib/prisma';
import { contaFormaPagamentoSyncResultDTOSchema } from '@/features/conta/dtos';
import { mapContaFormaPagamentoSyncResultToDTO } from '@/features/conta/mappers';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';

type AsaasResponseErrorLike = {
  response?: {
    status?: number;
  };
};

/**
 * API para sincronizar dados de cartão e forma de pagamento do Asaas
 * 
 * Busca:
 * - Dados do cartão salvo no customer
 * - Forma de pagamento (billingType) da assinatura ativa
 * 
 * E salva localmente no modelo Responsavel
 */
export async function POST(_req: NextRequest) {
  try {
    // 1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string; contaId: string };
    
    // 2. Apenas RESPONSAVEL pode acessar
    if (user.role !== 'RESPONSAVEL') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const forceRefresh = _req.nextUrl.searchParams.get('fresh') === '1';

    // 3. Buscar responsável
    const responsavel = await prisma.responsavel.findFirst({
      where: {
        usuarioId: user.id,
        contaId: user.contaId,
      },
      select: {
        id: true,
        asaasCustomerId: true,
        asaasCreditCardToken: true,
        preferredBillingType: true,
        creditCardBrand: true,
        creditCardLast4: true,
      }
    });

    if (!responsavel) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    if (!responsavel.asaasCustomerId) {
      return NextResponse.json(
        contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO({
          synced: false,
          message: 'Customer Asaas não encontrado. Crie uma matrícula primeiro.',
        })),
      );
    }

    let cardSynced = false;
    let billingTypeSynced = false;
    let cardData = null;
    let billingType = null;

    const localCardData =
      responsavel.creditCardBrand && responsavel.creditCardLast4
        ? {
            token: responsavel.asaasCreditCardToken ?? 'local_snapshot',
            brand: responsavel.creditCardBrand,
            last4: responsavel.creditCardLast4,
          }
        : null;
    const localBillingType = responsavel.preferredBillingType ?? null;

    if (!forceRefresh && (localBillingType || localCardData)) {
      recordAsaasReadDecision('payment_method_sync', 'local');
      return NextResponse.json(
        contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO({
          synced: true,
          cardSynced: Boolean(localCardData),
          billingTypeSynced: Boolean(localBillingType),
          data: {
            creditCard: localCardData,
            billingType: localBillingType,
          },
        })),
      );
    }

    try {
      recordAsaasReadDecision('payment_method_sync', forceRefresh ? 'fresh_remote' : 'remote');
      // 4. Buscar assinatura ativa (tem billingType e creditCardToken se for cartão)
      const assinatura = await prisma.matricula.findFirst({
        where: {
          responsavelFinanceiroId: responsavel.id,
          status: 'ATIVA',
          asaasSubscriptionId: {
            not: null,
          }
        },
        select: {
          id: true,
          asaasSubscriptionId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!assinatura?.asaasSubscriptionId) {
        console.log('[Sync] Nenhuma assinatura ativa encontrada');
        return NextResponse.json(
          contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO({
            synced: false,
            message: 'Nenhuma assinatura ativa encontrada',
          })),
        );
      }

      // 5. Buscar dados da subscription no Asaas
      recordAsaasReadIntent('MANUAL_REPAIR');
      const subscription = await getSubscription(assinatura.asaasSubscriptionId, {
        contaId: user.contaId,
      });

      console.log('[Sync] Subscription Asaas:', {
        subscriptionId: subscription.id,
        billingType: subscription.billingType,
        hasExternalPayment:
          'externalPayment' in subscription && Boolean(subscription.externalPayment),
      });

      // 6. Sincronizar billingType
      const billingTypeMap: Record<string, string> = {
        BOLETO: 'BOLETO',
        PIX: 'PIX',
        CREDIT_CARD: 'CREDIT_CARD',
        UNDEFINED: 'BOLETO', // fallback
      };

      billingType = billingTypeMap[subscription.billingType] || localBillingType || 'BOLETO';
      
      await prisma.responsavel.update({
        where: { id: responsavel.id },
        data: {
          preferredBillingType: billingType,
        },
      });

      billingTypeSynced = true;
      console.log('[Sync] BillingType sincronizado:', billingType);

      // 7. Se assinatura é de CARTÃO, buscar últimas cobranças pagas com cartão
      if (!localCardData && subscription.billingType === 'CREDIT_CARD') {
        // Buscar cobrança mais recente paga com cartão desta matrícula
        const cobrancaPaga = await prisma.cobranca.findFirst({
          where: {
            matriculaId: assinatura.id,
            status: 'PAGO',
            formaPagamento: 'CARTAO_CREDITO',
            asaasPaymentId: {
              not: null,
            }
          },
          select: {
            asaasPaymentId: true,
          },
          orderBy: {
            dataPagamento: 'desc',
          },
        });

        console.log('[Sync] Cobrança paga com cartão encontrada:', !!cobrancaPaga);

        if (cobrancaPaga?.asaasPaymentId) {
          try {
            recordAsaasReadIntent('MANUAL_REPAIR');
            const payment = await getPayment(cobrancaPaga.asaasPaymentId, {
              contaId: user.contaId,
            });

            console.log('[Sync] Payment encontrado:', {
              paymentId: payment.id,
              billingType: payment.billingType,
              creditCard: Boolean(payment.creditCard),
            });

            // Se payment tem dados de cartão
            if (payment.creditCard && payment.creditCard.creditCardNumber && payment.creditCard.creditCardBrand) {
              const brandMap: Record<string, string> = {
                VISA: 'VISA',
                MASTERCARD: 'MASTERCARD',
                MASTER: 'MASTERCARD',
                AMEX: 'AMEX',
                AMERICAN_EXPRESS: 'AMEX',
                ELO: 'ELO',
                HIPERCARD: 'HIPERCARD',
                DINERS: 'DINERS',
                DINERS_CLUB: 'DINERS',
              };

              const brand = payment.creditCard.creditCardBrand;
              const last4 = payment.creditCard.creditCardNumber;

              cardData = {
                token: 'imported_from_payment',
                brand: brandMap[brand.toUpperCase()] || brand,
                last4: last4,
              };

              await prisma.responsavel.update({
                where: { id: responsavel.id },
                data: {
                  asaasCreditCardToken: cardData.token,
                  creditCardBrand: cardData.brand,
                  creditCardLast4: cardData.last4,
                  creditCardUpdatedAt: new Date(),
                },
              });

              cardSynced = true;
              console.log('[Sync] Cartão sincronizado do payment:', cardData);
            }
          } catch (paymentError) {
            console.error('[Sync] Erro ao buscar payment:', paymentError);
          }
        } else {
          console.log('[Sync] Assinatura é CREDIT_CARD mas nenhuma cobrança paga encontrada');
        }
      } else if (!localCardData) {
        // Se assinatura não é CREDIT_CARD, mas pode ter cobrança paga com cartão
        // (caso usuário tenha pago boleto com cartão na fatura do Asaas)
        const cobrancaPagaCartao = await prisma.cobranca.findFirst({
          where: {
            matriculaId: assinatura.id,
            status: 'PAGO',
            asaasPaymentId: {
              not: null,
            }
          },
          select: {
            asaasPaymentId: true,
          },
          orderBy: {
            dataPagamento: 'desc',
          },
        });

        console.log('[Sync] Buscando cartão em cobranças pagas:', !!cobrancaPagaCartao);

        if (cobrancaPagaCartao?.asaasPaymentId) {
          try {
            recordAsaasReadIntent('MANUAL_REPAIR');
            const payment = await getPayment(cobrancaPagaCartao.asaasPaymentId, {
              contaId: user.contaId,
            });

            console.log('[Sync] Payment encontrado (fallback):', {
              paymentId: payment.id,
              billingType: payment.billingType,
            });

            // Se payment foi pago com cartão
            if (payment.billingType === 'CREDIT_CARD' && payment.creditCard && 
                payment.creditCard.creditCardNumber && payment.creditCard.creditCardBrand) {
              const brandMap: Record<string, string> = {
                VISA: 'VISA',
                MASTERCARD: 'MASTERCARD',
                MASTER: 'MASTERCARD',
                AMEX: 'AMEX',
                AMERICAN_EXPRESS: 'AMEX',
                ELO: 'ELO',
                HIPERCARD: 'HIPERCARD',
                DINERS: 'DINERS',
                DINERS_CLUB: 'DINERS',
              };

              const brand = payment.creditCard.creditCardBrand;
              const last4 = payment.creditCard.creditCardNumber;

              cardData = {
                token: 'imported_from_payment',
                brand: brandMap[brand.toUpperCase()] || brand,
                last4: last4,
              };

              await prisma.responsavel.update({
                where: { id: responsavel.id },
                data: {
                  asaasCreditCardToken: cardData.token,
                  creditCardBrand: cardData.brand,
                  creditCardLast4: cardData.last4,
                  creditCardUpdatedAt: new Date(),
                },
              });

              cardSynced = true;
              console.log('[Sync] Cartão sincronizado (fallback):', cardData);
            }
          } catch (paymentError) {
            console.error('[Sync] Erro ao buscar payment (fallback):', paymentError);
          }
        }
      }

      // 8. Retornar resultado
      return NextResponse.json(
        contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO({
          synced: true,
          cardSynced: cardSynced || Boolean(localCardData),
          billingTypeSynced,
          data: {
            creditCard: cardData ?? localCardData,
            billingType,
          },
        })),
      );

    } catch (asaasError: unknown) {
      console.error('[Sync] Erro ao buscar dados do Asaas:', asaasError);
      const asaasResponseError = asaasError as AsaasResponseErrorLike;
      
      // Se for erro 404, customer não existe
      if (asaasResponseError.response?.status === 404) {
        return NextResponse.json(
          contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO({
            synced: false,
            message: 'Customer não encontrado no Asaas',
          })),
        );
      }

      throw asaasError;
    }

  } catch (error) {
    console.error('[Sync] Erro ao sincronizar:', error);
    return NextResponse.json(
      { error: 'Erro ao sincronizar dados do Asaas' }, 
      { status: 500 }
    );
  }
}
