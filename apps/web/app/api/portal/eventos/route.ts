import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import { portalEventosResultDTOSchema } from '@/features/portal/dtos';
import { mapPortalEventoToDTO, mapPortalEventosResultToDTO } from '@/features/portal/mappers';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const alunoIds = await resolvePortalAlunoIds(auth.user);

    // 4. Buscar eventos da conta
    const eventos = await prisma.portalEvento.findMany({
      where: {
        contaId: auth.user.contaId,
        status: { in: ['ATIVO', 'ENCERRADO'] }, // Mostrar eventos ativos e encerrados recentes
      },
      select: {
        id: true,
        nome: true,
        descricao: true,
        dataInicio: true,
        dataFim: true,
        local: true,
        tipo: true,
        capacidade: true,
        status: true,
        // Incluir inscrições apenas dos alunos relacionados ao usuário
        inscricoes: {
          where: {
            alunoId: { in: alunoIds },
          },
          select: {
            id: true,
            status: true,
            quantidade: true,
            valorTotal: true,
            qrCode: true,
          },
          take: 1, // Um aluno só pode ter uma inscrição por evento
        },
      },
      orderBy: {
        dataInicio: 'desc',
      },
      take: 50, // Limitar a 50 eventos mais recentes
    });

    // 5. Formatar dados
    const eventosFormatados = eventos.map((e) => ({
      id: e.id,
      nome: e.nome,
      descricao: e.descricao,
      dataInicio: e.dataInicio.toISOString(),
      dataFim: e.dataFim ? e.dataFim.toISOString() : null,
      local: e.local,
      tipo: e.tipo,
      capacidade: e.capacidade,
      status: e.status,
      inscricao: e.inscricoes[0]
        ? {
            id: e.inscricoes[0].id,
            status: e.inscricoes[0].status,
            quantidade: e.inscricoes[0].quantidade,
            valorTotal: Number(e.inscricoes[0].valorTotal),
            qrCode: e.inscricoes[0].qrCode || '',
          }
        : undefined,
    }));

    // 6. Retornar dados
    return NextResponse.json(
      portalEventosResultDTOSchema.parse(
        mapPortalEventosResultToDTO({
          eventos: eventosFormatados.map((evento) => mapPortalEventoToDTO(evento)),
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar eventos:', error);
    return NextResponse.json({ error: 'Erro ao carregar eventos' }, { status: 500 });
  }
}
