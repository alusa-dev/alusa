import prisma from '@/lib/prisma';
import type { NextRequest } from 'next/server';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import { portalFinanceiroListResultDTOSchema } from '@/features/portal/dtos';
import {
  mapPortalFinanceiroListItemToDTO,
  mapPortalFinanceiroListResultToDTO,
} from '@/features/portal/mappers';
import { listPortalStandaloneCharges } from '@/features/portal/finance-standalone';
import {
  reconcileAsaasPaymentIds,
  resolveAcademicDisplayedStatus,
  shouldReconcileAsaasOnRead,
} from '@/src/server/finance/academic-payment-history';
import { jsonNoStore } from '@/lib/http-security';

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const portalUser = auth.user;
    if (!portalUser?.contaId) {
      return jsonNoStore({ error: 'Usuário do portal não autenticado' }, { status: 401 });
    }

    const alunoIds = await resolvePortalAlunoIds(portalUser);

    async function loadPortalFinanceData() {
      const [cobrancas, standaloneCharges] = await Promise.all([
        prisma.cobranca.findMany({
          where: {
            matricula: {
              alunoId: { in: alunoIds },
            },
          },
          include: {
            matricula: {
              include: {
                aluno: {
                  select: {
                    nome: true,
                  },
                },
                turma: {
                  select: {
                    nome: true,
                    modalidade: {
                      select: {
                        nome: true,
                      },
                    },
                  },
                },
                responsavelFinanceiro: {
                  select: {
                    asaasCreditCardToken: true,
                    creditCardBrand: true,
                    creditCardLast4: true,
                  },
                },
              },
            },
            pagamentos: {
              select: {
                id: true,
                dataPagamento: true,
                valorPago: true,
                status: true,
              },
              orderBy: {
                dataPagamento: 'desc',
              },
              take: 1,
            },
          },
          orderBy: {
            vencimento: 'desc',
          },
        }),
        listPortalStandaloneCharges({ contaId: portalUser.contaId, alunoIds }),
      ]);

      return { cobrancas, standaloneCharges };
    }

    let { cobrancas, standaloneCharges } = await loadPortalFinanceData();
    if (shouldReconcileAsaasOnRead(req.nextUrl.searchParams)) {
      const reconciliation = await reconcileAsaasPaymentIds({
        contaId: portalUser.contaId,
        asaasPaymentIds: [
          ...cobrancas.map((cobranca) => cobranca.asaasPaymentId),
          ...standaloneCharges.map((charge) => charge.asaasId),
        ],
        limit: 100,
      });
      if (reconciliation.attempted > 0) {
        ({ cobrancas, standaloneCharges } = await loadPortalFinanceData());
      }
    }

    // 5. Formatar dados e atualizar status de atrasadas
    const cobrancasAcademicas = cobrancas.map((c) => {
      return {
        id: c.id,
        valor: Number(c.valor),
        vencimento: c.vencimento.toISOString(),
        status: resolveAcademicDisplayedStatus({
          localCobrancaStatus: c.status,
          remotePaymentStatus: c.asaasStatus,
          dueDate: c.vencimento,
        }),
        formaPagamento: c.formaPagamento,
        asaasId: c.asaasId,
        matricula: {
          aluno: {
            nome: c.matricula.aluno.nome,
          },
          turma: c.matricula.turma ? {
            nome: c.matricula.turma.nome,
            modalidade: {
              nome: c.matricula.turma.modalidade.nome,
            },
          } : null,
          responsavelFinanceiro: c.matricula.responsavelFinanceiro ? {
            hasSavedCard: Boolean(c.matricula.responsavelFinanceiro.asaasCreditCardToken),
            creditCardBrand: c.matricula.responsavelFinanceiro.creditCardBrand,
            creditCardLast4: c.matricula.responsavelFinanceiro.creditCardLast4,
          } : null,
        },
        pagamentos: c.pagamentos.map((p) => ({
          id: p.id,
          dataPagamento: p.dataPagamento ? p.dataPagamento.toISOString() : null,
          valorPago: Number(p.valorPago),
          status: p.status,
        })),
      };
    });

    const cobrancasFormatadas = [...cobrancasAcademicas, ...standaloneCharges]
      .sort((a, b) => new Date(b.vencimento).getTime() - new Date(a.vencimento).getTime());

    // 6. Retornar dados
    return jsonNoStore(
      portalFinanceiroListResultDTOSchema.parse(
        mapPortalFinanceiroListResultToDTO({
          cobrancas: cobrancasFormatadas.map((cobranca) =>
            mapPortalFinanceiroListItemToDTO(cobranca),
          ),
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar cobranças:', error);
    return jsonNoStore({ error: 'Erro ao carregar cobranças' }, { status: 500 });
  }
}
