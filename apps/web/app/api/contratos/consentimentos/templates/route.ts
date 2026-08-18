import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { listContratoConsentimentoTemplatesResultDTOSchema } from '@/features/contratos/dtos';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });

  try {
    const templates = await prisma.contratoConsentimentoTemplate.findMany({
      where: {
        ativo: true,
        OR: [
          { contaId: null, origem: 'SISTEMA', slug: 'uso-imagem', grupoSlug: null },
          { contaId: user.contaId },
        ],
      },
      orderBy: [{ origem: 'asc' }, { nome: 'asc' }, { versao: 'desc' }],
      select: {
        id: true,
        slug: true,
        nome: true,
        finalidade: true,
        titulo: true,
        texto: true,
        variaveis: true,
        grupoSlug: true,
        grupoNome: true,
        grupoDescricao: true,
        introducao: true,
        encerramento: true,
        ordem: true,
        versao: true,
        origem: true,
      },
    });

    return NextResponse.json(listContratoConsentimentoTemplatesResultDTOSchema.parse(templates));
  } catch (error) {
    console.error('[CONTRATO_CONSENTIMENTO_TEMPLATES_GET]', error);
    return NextResponse.json({ error: { message: 'Erro ao listar templates de consentimento' } }, { status: 500 });
  }
}
