import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { AsaasEnvError, getPayment, isAsaasEnabled } from '@alusa/finance';
import type { AsaasPayment } from '@alusa/asaas';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import {
  portalFinanceiroDetailDTOSchema,
  portalRouteIdParamsDTOSchema,
} from '@/features/portal/dtos';
import { mapPortalFinanceiroDetailToDTO } from '@/features/portal/mappers';
import {
  mapChargeStatusToPortalStatus,
  resolvePortalScopedPayerIds,
} from '@/features/portal/finance-standalone';
import {
  buildAcademicAsaasData,
  buildStandaloneAsaasData,
  shouldFetchAcademicAsaasDetail,
  shouldFetchStandaloneAsaasDetail,
} from '@/src/server/finance/asaas-payment-detail-policy';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { jsonNoStore } from '@/lib/http-security';

function resolveInvoiceUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    const rawParams = await params;
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const { id } = portalRouteIdParamsDTOSchema.parse(params);
    const alunoIds = await resolvePortalAlunoIds(auth.user);

    const forceRefresh = req.nextUrl.searchParams.get('fresh') === '1';
    const asaasActive = isAsaasEnabled();

    // 3. Buscar cobrança com todos os detalhes já dentro do escopo do portal
    const cobranca = await prisma.cobranca.findFirst({
      where: {
        id,
        matricula: {
          alunoId: { in: alunoIds },
          aluno: { contaId: auth.user.contaId },
        },
      },
      include: {
        matricula: {
          include: {
            aluno: {
              select: { 
                id: true,
                usuarioId: true,
                nome: true,
                cpf: true,
                email: true,
                telefone: true,
              }
            },
            turma: {
              include: {
                modalidade: {
                  select: {
                    nome: true,
                  }
                }
              }
            },
            responsavelFinanceiro: {
              select: {
                id: true,
                asaasCreditCardToken: true,
                creditCardBrand: true,
                creditCardLast4: true,
                creditCardExpiryMonth: true,
                creditCardExpiryYear: true,
              }
            }
          }
        },
        pagamentos: {
          orderBy: {
            dataPagamento: 'desc'
          }
        }
      }
    });

    let standaloneCharge: {
      id: string;
      status: import('@prisma/client').ChargeStatus;
      value: import('@prisma/client').Prisma.Decimal | null;
      dueDate: Date | null;
      createdAt: Date;
      updatedAt: Date;
      statusUpdatedAt: Date;
      billingType: string | null;
      asaasPaymentId: string | null;
      invoiceUrl: string | null;
      payerName: string | null;
      description: string | null;
    } | null = null;

    if (!cobranca) {
      const payerScope = await resolvePortalScopedPayerIds(auth.user.contaId, alunoIds);
      const payerFilters: Array<{ customer: { payerType: 'ALUNO' | 'RESPONSAVEL'; payerId: { in: string[] } } }> = [];

      if (payerScope.alunoIds.length) {
        payerFilters.push({ customer: { payerType: 'ALUNO', payerId: { in: payerScope.alunoIds } } });
      }
      if (payerScope.responsavelIds.length) {
        payerFilters.push({ customer: { payerType: 'RESPONSAVEL', payerId: { in: payerScope.responsavelIds } } });
      }

      if (payerFilters.length) {
        standaloneCharge = await prisma.charge.findFirst({
          where: {
            id,
            contaId: auth.user.contaId,
            cobrancaId: null,
            OR: payerFilters,
          },
          select: {
            id: true,
            status: true,
            value: true,
            dueDate: true,
            createdAt: true,
            updatedAt: true,
            statusUpdatedAt: true,
            billingType: true,
            asaasPaymentId: true,
            invoiceUrl: true,
            payerName: true,
            description: true,
          },
        });
      }
    }

    if (!cobranca && !standaloneCharge) {
      return jsonNoStore({ error: 'Cobrança não encontrada' }, { status: 404 });
    }

    // 5. Usar snapshot local por padrão; remoto só com fresh=1 ou estado incerto
    let asaasData: AsaasPayment | null = null;
    const asaasPaymentId = cobranca?.asaasPaymentId ?? standaloneCharge?.asaasPaymentId ?? null;
    const shouldFetchRemote = cobranca
      ? shouldFetchAcademicAsaasDetail({
          forceRefresh,
          isAsaasActive: asaasActive,
          cobranca: cobranca as unknown as Record<string, unknown>,
        })
      : standaloneCharge
        ? shouldFetchStandaloneAsaasDetail({
            forceRefresh,
            isAsaasActive: asaasActive,
            charge: standaloneCharge as unknown as Record<string, unknown>,
          })
        : false;

    if (asaasActive && asaasPaymentId && shouldFetchRemote) {
      recordAsaasReadDecision('portal_financeiro_detail', forceRefresh ? 'fresh_remote' : 'remote');
      try {
        asaasData = await getPayment(asaasPaymentId, { contaId: auth.user.contaId });
      } catch (asaasError: unknown) {
        if (asaasError instanceof AsaasEnvError) {
          console.warn('[Portal Financeiro] Integração Asaas indisponível:', asaasError.message);
        } else if (asaasError instanceof Error) {
          console.error('[Portal Financeiro] Erro ao consultar Asaas:', asaasError);
        } else {
          console.error('[Portal Financeiro] Erro ao consultar Asaas:', asaasError);
        }
      }
    } else {
      recordAsaasReadDecision('portal_financeiro_detail', 'local');
    }

    const localAsaasData = cobranca
      ? buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>)
      : standaloneCharge
        ? buildStandaloneAsaasData(standaloneCharge as unknown as Record<string, unknown>)
        : null;
    const effectiveAsaasData = asaasData ?? localAsaasData;
    const invoiceUrl =
      resolveInvoiceUrl(asaasData?.invoiceUrl) ??
      resolveInvoiceUrl(standaloneCharge?.invoiceUrl) ??
      resolveInvoiceUrl(
        effectiveAsaasData && 'invoiceUrl' in effectiveAsaasData
          ? effectiveAsaasData.invoiceUrl
          : null,
      );
    const transactionReceiptUrl = asaasData?.transactionReceiptUrl ?? null;

    // 6. Formatar e retornar
    const response = cobranca
      ? {
          id: cobranca.id,
          tipo: cobranca.tipo,
          valor: Number(cobranca.valor),
          vencimento: cobranca.vencimento.toISOString(),
          status: cobranca.status,
          formaPagamento: cobranca.formaPagamento,
          asaasId: cobranca.asaasId,
          asaasPaymentId: cobranca.asaasPaymentId,
          invoiceUrl,
          transactionReceiptUrl,
          descricao: cobranca.descricao,
          valorJuros: cobranca.juros ? Number(cobranca.juros) : null,
          valorMulta: cobranca.multa ? Number(cobranca.multa) : null,
          valorDesconto: cobranca.desconto ? Number(cobranca.desconto) : null,
          asaasData: effectiveAsaasData,
          matricula: {
            aluno: {
              nome: cobranca.matricula.aluno.nome,
              cpf: cobranca.matricula.aluno.cpf,
              email: cobranca.matricula.aluno.email,
              telefone: cobranca.matricula.aluno.telefone,
            },
            turma: cobranca.matricula.turma
              ? {
                  nome: cobranca.matricula.turma.nome,
                  modalidade: {
                    nome: cobranca.matricula.turma.modalidade.nome,
                  },
                }
              : null,
            responsavelFinanceiro: cobranca.matricula.responsavelFinanceiro ? {
              hasSavedCard: Boolean(cobranca.matricula.responsavelFinanceiro.asaasCreditCardToken),
              creditCardBrand: cobranca.matricula.responsavelFinanceiro.creditCardBrand,
              creditCardLast4: cobranca.matricula.responsavelFinanceiro.creditCardLast4,
              creditCardExpiryMonth: cobranca.matricula.responsavelFinanceiro.creditCardExpiryMonth,
              creditCardExpiryYear: cobranca.matricula.responsavelFinanceiro.creditCardExpiryYear,
            } : null,
          },
          pagamentos: cobranca.pagamentos.map(p => ({
            id: p.id,
            dataPagamento: p.dataPagamento ? p.dataPagamento.toISOString() : null,
            valorPago: Number(p.valorPago),
            status: p.status,
            formaPagamento: p.formaPagamento,
          })),
        }
      : {
          id: standaloneCharge!.id,
          tipo: 'AVULSA',
          valor: Number(standaloneCharge!.value ?? 0),
          vencimento: (standaloneCharge!.dueDate ?? new Date()).toISOString(),
          status: mapChargeStatusToPortalStatus(standaloneCharge!.status, standaloneCharge!.dueDate),
          formaPagamento: standaloneCharge!.billingType,
          asaasId: standaloneCharge!.asaasPaymentId,
          asaasPaymentId: standaloneCharge!.asaasPaymentId,
          invoiceUrl: invoiceUrl ?? standaloneCharge!.invoiceUrl,
          transactionReceiptUrl,
          descricao: standaloneCharge!.description,
          valorJuros: null,
          valorMulta: null,
          valorDesconto: null,
          asaasData: effectiveAsaasData,
          matricula: {
            aluno: {
              nome: standaloneCharge!.payerName ?? 'Pagador não identificado',
              cpf: null,
              email: null,
              telefone: null,
            },
            turma: null,
            responsavelFinanceiro: null,
          },
          pagamentos: [],
        };

    return jsonNoStore(
      portalFinanceiroDetailDTOSchema.parse(mapPortalFinanceiroDetailToDTO(response)),
    );
  } catch (error) {
    console.error('Erro ao buscar cobrança:', error);
    return jsonNoStore(
      { error: 'Erro ao buscar cobrança' }, 
      { status: 500 }
    );
  }
}
