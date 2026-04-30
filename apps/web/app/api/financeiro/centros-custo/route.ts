import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import {
  centroCustoInputDTOSchema,
  centroCustoMutationResultDTOSchema,
  centroCustoQueryDTOSchema,
  listCentroCustoResultDTOSchema,
} from '@/features/financeiro/centros-custo/dtos';
import {
  mapCentroCustoToDTO,
  mapListCentroCustoResultToDTO,
} from '@/features/financeiro/centros-custo/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export const centroCustoCreateSchema = centroCustoInputDTOSchema;

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const parsedQuery = centroCustoQueryDTOSchema.safeParse({
      tipo: url.searchParams.get('tipo') || undefined,
      status: url.searchParams.get('status') || 'ATIVO',
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { tipo, status } = parsedQuery.data;

    const where: Record<string, unknown> = { contaId: user.contaId };
    if (tipo) where.tipo = tipo;
    if (status) where.status = status;

    const data = await prisma.centroCusto.findMany({
      where,
      orderBy: [{ nome: 'asc' }],
      include: {
        _count: { select: { lancamentos: true } },
      },
    });

    return NextResponse.json(
      listCentroCustoResultDTOSchema.parse(
        mapListCentroCustoResultToDTO({
          data: data.map((item) => mapCentroCustoToDTO(item as unknown as Record<string, unknown>)),
        }),
      ),
    );
  } catch (e) {
    console.error('[API centro de custo][GET]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const parsed = centroCustoInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    const existing = await prisma.centroCusto.findFirst({
      where: {
        contaId: user.contaId,
        nome: body.nome.trim(),
        tipo: body.tipo,
      },
    });
    if (existing) return err(409, 'JA_EXISTE', 'Centro de custo já existe para este tipo');

    const created = await prisma.centroCusto.create({
      data: {
        contaId: user.contaId,
        nome: body.nome.trim(),
        tipo: body.tipo,
        descricao: body.descricao?.trim() || null,
        status: body.status,
      },
    });

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCentroCustoToDTO(created as unknown as Record<string, unknown>),
      }),
      { status: 201 },
    );
  } catch (e) {
    console.error('[API centro de custo][POST]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
