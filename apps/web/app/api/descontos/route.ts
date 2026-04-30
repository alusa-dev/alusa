import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const descontoListItemDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  tipo: z.enum(['FIXO', 'PERCENTUAL']),
  valor: z.number(),
  escopo: z.string(),
  status: z.string(),
});

const descontoListResultDTOSchema = z.object({
  items: z.array(descontoListItemDTOSchema),
});

const createDescontoInputDTOSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  tipo: z.enum(['FIXO', 'PERCENTUAL']),
  valor: z.number().positive(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
    }

    const descontos = await prisma.desconto.findMany({
      where: {
        contaId,
        status: 'ATIVO',
      },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        tipo: true,
        valor: true,
        escopo: true,
        status: true,
      },
    });

    return NextResponse.json(
      descontoListResultDTOSchema.parse({
        items: descontos.map((desconto) => ({
          id: desconto.id,
          nome: desconto.nome,
          tipo: desconto.tipo === 'FIXO' ? 'FIXO' : 'PERCENTUAL',
          valor: Number(desconto.valor),
          escopo: desconto.escopo,
          status: desconto.status,
        })),
      }),
    );
  } catch (error) {
    console.error('[API Descontos] Erro ao listar descontos:', error);
    return NextResponse.json(
      { error: { message: 'Erro ao carregar benefícios.' } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
    }

    const raw = await request.json().catch(() => null);
    const parsed = createDescontoInputDTOSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: { message: parsed.error.issues[0]?.message ?? 'Payload inválido.' } },
        { status: 400 },
      );
    }

    if (parsed.data.tipo === 'PERCENTUAL' && parsed.data.valor > 100) {
      return NextResponse.json(
        { error: { message: 'Benefício percentual não pode ser maior que 100%.' } },
        { status: 400 },
      );
    }

    const created = await prisma.desconto.create({
      data: {
        contaId,
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        valor: parsed.data.valor,
        escopo: 'MATRICULA',
        status: 'ATIVO',
      },
      select: {
        id: true,
        nome: true,
        tipo: true,
        valor: true,
        escopo: true,
        status: true,
      },
    });

    return NextResponse.json({
      item: descontoListItemDTOSchema.parse({
        id: created.id,
        nome: created.nome,
        tipo: created.tipo === 'FIXO' ? 'FIXO' : 'PERCENTUAL',
        valor: Number(created.valor),
        escopo: created.escopo,
        status: created.status,
      }),
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === 'P2002') {
      return NextResponse.json(
        { error: { message: 'Já existe um benefício com esse nome na conta.' } },
        { status: 409 },
      );
    }

    console.error('[API Descontos] Erro ao criar desconto:', error);
    return NextResponse.json(
      { error: { message: 'Erro ao cadastrar benefício.' } },
      { status: 500 },
    );
  }
}
