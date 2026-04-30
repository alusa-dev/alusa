import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import { portalNotificationsResultDTOSchema } from '@/features/portal/dtos';
import { mapPortalNotificationsResultToDTO } from '@/features/portal/mappers';
import { isPortalPendingStatus, listPortalStandaloneCharges } from '@/features/portal/finance-standalone';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const alunoIds = await resolvePortalAlunoIds(auth.user);

    // 4. Buscar cobranças dos alunos
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const [cobrancas, standaloneCharges] = await Promise.all([
      prisma.cobranca.findMany({
        where: {
          matricula: {
            alunoId: { in: alunoIds },
          },
          OR: [
            { status: 'PENDENTE' },
            { status: 'ATRASADO' },
          ],
        },
        select: {
          id: true,
          status: true,
          vencimento: true,
        },
      }),
      listPortalStandaloneCharges({ contaId: auth.user.contaId, alunoIds }),
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

    // 6. Buscar próximos eventos (próximos 30 dias)
    const daqui30Dias = new Date();
    daqui30Dias.setDate(daqui30Dias.getDate() + 30);

    const proximosEventos = await prisma.portalEvento.findMany({
      where: {
        contaId: auth.user.contaId,
        status: 'ATIVO',
        dataInicio: {
          gte: hoje,
          lte: daqui30Dias,
        },
        inscricoes: {
          some: {
            alunoId: { in: alunoIds },
            status: 'CONFIRMADA',
          },
        },
      },
      select: { id: true },
    });

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



