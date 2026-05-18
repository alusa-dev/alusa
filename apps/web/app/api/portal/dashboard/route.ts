import { NextRequest, NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/prisma-tenant';
import { requirePortalUser, resolvePortalScopedAlunoIds } from '@/features/portal/api-helpers';
import {
  portalDashboardQueryDTOSchema,
  portalDashboardResultDTOSchema,
} from '@/features/portal/dtos';
import { mapPortalDashboardResultToDTO } from '@/features/portal/mappers';
import { isPortalPendingStatus, listPortalStandaloneCharges } from '@/features/portal/finance-standalone';
import {
  reconcileAsaasPaymentIds,
  resolveAcademicDisplayedStatus,
} from '@/src/server/finance/academic-payment-history';

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const portalUser = auth.user;
    if (!portalUser?.contaId) {
      return NextResponse.json(
        { error: 'Usuário do portal não autenticado' },
        { status: 401 },
      );
    }
    const query = portalDashboardQueryDTOSchema.parse({
      alunoId: req.nextUrl.searchParams.get('alunoId') || undefined,
    });
    const scope = await resolvePortalScopedAlunoIds(auth.user, query.alunoId);
    if ('response' in scope) return scope.response;
    const alunoIds = scope.alunoIds;

    async function loadDashboardData() {
      if (!alunoIds.length) {
        return { matriculas: [], cobrancas: [], standaloneCharges: [] };
      }

      return runWithTenant(portalUser.contaId, async (tx) => {
        const [matriculas, cobrancas, standaloneCharges] = await Promise.all([
          tx.matricula.findMany({
            where: {
              alunoId: { in: alunoIds },
              status: 'ATIVA',
            },
            select: { id: true },
          }),
          tx.cobranca.findMany({
            where: {
              matricula: {
                alunoId: { in: alunoIds },
              },
            },
            select: {
              id: true,
              status: true,
              valor: true,
              vencimento: true,
              asaasPaymentId: true,
              asaasStatus: true,
            },
          }),
          listPortalStandaloneCharges({ contaId: portalUser.contaId, alunoIds }),
        ]);

        return { matriculas, cobrancas, standaloneCharges };
      });
    }

    let { matriculas, cobrancas, standaloneCharges } = await loadDashboardData();
    const reconciliation = await reconcileAsaasPaymentIds({
      contaId: portalUser.contaId,
      asaasPaymentIds: [
        ...cobrancas.map((cobranca) => cobranca.asaasPaymentId),
        ...standaloneCharges.map((charge) => charge.asaasId),
      ],
      limit: 100,
    });
    if (reconciliation.attempted > 0) {
      ({ matriculas, cobrancas, standaloneCharges } = await loadDashboardData());
    }

    // 4. Calcular métricas
    const totalMatriculas = matriculas.length;
    const matriculasAtivas = matriculas.length;

    const cobrancasPendentes = cobrancas.filter((c) =>
      isPortalPendingStatus(
        resolveAcademicDisplayedStatus({
          localCobrancaStatus: c.status,
          remotePaymentStatus: c.asaasStatus,
          dueDate: c.vencimento,
        }),
      ),
    );
    const standalonePendentes = standaloneCharges.filter((c) => isPortalPendingStatus(c.status));

    const totalPendencias = [...cobrancasPendentes, ...standalonePendentes];
    const totalPendente = Number(totalPendencias.reduce((sum, c) => sum + Number(c.valor), 0));

    // Próximo vencimento
    const proximasCobrancas = totalPendencias
      .filter((c) => new Date(c.vencimento) >= new Date())
      .sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime());

    const proxVencimento = proximasCobrancas[0]
      ? {
          data: proximasCobrancas[0].vencimento.toISOString(),
          valor: Number(proximasCobrancas[0].valor),
        }
      : undefined;

    // Eventos (placeholder - implementar quando o módulo de eventos estiver completo)
    const eventosProximos = 0;

    // 5. Retornar dados
    return NextResponse.json(
      portalDashboardResultDTOSchema.parse(
        mapPortalDashboardResultToDTO({
          matriculas: {
            ativas: matriculasAtivas,
            total: totalMatriculas,
          },
          financeiro: {
            pendentes: totalPendencias.length,
            totalPendente,
            proxVencimento,
          },
          eventos: {
            proximos: eventosProximos,
          },
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar dados do dashboard:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar dados do dashboard' },
      { status: 500 },
    );
  }
}
