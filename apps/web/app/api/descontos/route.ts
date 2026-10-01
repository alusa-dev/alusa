import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import {
  createDiscount,
  listActiveDiscounts,
} from '@/src/server/finance/discount.service';

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

const createDiscountInputDTOSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  tipo: z.enum(['FIXO', 'PERCENTUAL']),
  valor: z.number().positive(),
});

export async function GET(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
    }
    const { contaId } = auth;

    const descontos = await listActiveDiscounts(contaId);

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
    logApiOperationalEvent({ severity: 'error', eventName: 'api.discounts.request.failed', route: '/api/descontos', method: 'GET', requestId: getRequestId(request), error });
    return NextResponse.json(
      { error: { message: 'Erro ao carregar benefícios.' } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
    }
    const { contaId } = auth;

    const raw = await request.json().catch(() => null);
    const parsed = createDiscountInputDTOSchema.safeParse(raw);

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

    const created = await createDiscount({ contaId, ...parsed.data });

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

    logApiOperationalEvent({ severity: 'error', eventName: 'api.discounts.request.failed', route: '/api/descontos', method: 'POST', requestId: getRequestId(request), error });
    return NextResponse.json(
      { error: { message: 'Erro ao cadastrar benefício.' } },
      { status: 500 },
    );
  }
}
