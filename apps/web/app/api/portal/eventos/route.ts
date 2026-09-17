import { NextResponse } from 'next/server';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import { portalEventosResultDTOSchema } from '@/features/portal/dtos';
import { mapPortalEventoToDTO, mapPortalEventosResultToDTO } from '@/features/portal/mappers';
import { listPortalEvents } from '@/src/server/portal/portal-read.service';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const alunoIds = await resolvePortalAlunoIds(auth.user);

    // 4. Buscar eventos da conta
    const eventos = await listPortalEvents({ contaId: auth.user.contaId, alunoIds });

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
