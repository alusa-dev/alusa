import { NextResponse } from 'next/server';
import {
  requirePortalUser,
  resolvePortalAlunoIds,
  resolvePortalResponsavelId,
} from '@/features/portal/api-helpers';
import { portalNotificationsResultDTOSchema } from '@/features/portal/dtos';
import { mapPortalNotificationsResultToDTO } from '@/features/portal/mappers';
import { isPortalPendingStatus, listPortalStandaloneCharges } from '@/features/portal/finance-standalone';
import { getPortalNotificationData } from '@/src/server/portal/portal-read.service';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const alunoIds = await resolvePortalAlunoIds(auth.user);
    const responsavelId = await resolvePortalResponsavelId(auth.user);

    // 4. Buscar cobranças dos alunos
    const [{ cobrancas, proximosEventos, hoje }, standaloneCharges] = await Promise.all([
      getPortalNotificationData({ contaId: auth.user.contaId, alunoIds }),
      listPortalStandaloneCharges({ contaId: auth.user.contaId, alunoIds, responsavelId }),
    ]);

    // 5. Calcular notificações
    let cobrancasPendentes = 0;
    let cobrancasAtrasadas = 0;

    for (const c of cobrancas) {
      const vencimento = new Date(c.vencimento);
      vencimento.setHours(0, 0, 0, 0);

      if (vencimento < hoje) {
        cobrancasAtrasadas++;
      } else if (c.status === 'PENDENTE') {
        cobrancasPendentes++;
      }
    }

    for (const c of standaloneCharges) {
      if (!isPortalPendingStatus(c.status)) continue;
      const vencimento = new Date(c.vencimento);
      vencimento.setHours(0, 0, 0, 0);

      if (vencimento < hoje) {
        cobrancasAtrasadas++;
      } else {
        cobrancasPendentes++;
      }
    }

    // 7. Retornar notificações
    return NextResponse.json(
      portalNotificationsResultDTOSchema.parse(
        mapPortalNotificationsResultToDTO({
          cobrancasPendentes,
          cobrancasAtrasadas,
          proximosEventos: proximosEventos.length,
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar notificações:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar notificações' },
      { status: 500 },
    );
  }
}
