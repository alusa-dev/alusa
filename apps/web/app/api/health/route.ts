import { NextResponse } from 'next/server';
import { prisma } from '@/src/prisma';
import type { Prisma } from '@prisma/client';
import { appHealthResultDTOSchema } from '@/features/system/dtos';
import { mapAppHealthResultToDTO } from '@/features/system/mappers';
import { NO_STORE_HEADERS } from '@/lib/http-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Upsert da conta demo em ambientes de desenvolvimento/teste
    if (process.env.NODE_ENV !== 'production') {
      // 1) Garante a conta antes do usuário para evitar P2003 (FK)
      let conta = await prisma.conta.upsert({
        where: { id: 'conta-default' },
        update: {},
        create: {
          id: 'conta-default',
          nome: 'Alusa Demo',
          cpfCnpj: '00000000000191',
          status: 'ATIVO',
        } as Prisma.ContaUncheckedCreateInput,
      });
      // 2) Garante o usuário owner com contaId válido
      const owner = await prisma.usuario.upsert({
        where: { email: 'owner+health@example.com' },
        update: {},
        create: {
          id: 'owner-health',
          contaId: conta.id,
          nome: 'Owner Health',
          email: 'owner+health@example.com',
          senhaHash: 'x',
          role: 'ADMIN',
          status: 'ATIVO',
        },
      });
      // 3) Atualiza ownerUserId se necessário
      if (conta.ownerUserId !== owner.id) {
        conta = await prisma.conta.update({
          where: { id: conta.id },
          data: { ownerUserId: owner.id },
        });
      }
      return NextResponse.json(
        appHealthResultDTOSchema.parse(
          mapAppHealthResultToDTO({ ok: true, conta: { id: conta.id, nome: conta.nome } }),
        ),
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // Em produção, apenas um ping leve ao banco
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      appHealthResultDTOSchema.parse(mapAppHealthResultToDTO({ ok: true })),
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (e: unknown) {
    const message =
      process.env.NODE_ENV === 'production' ? 'health check failed' : (e as Error).message || 'erro no health';
    return NextResponse.json(
      appHealthResultDTOSchema.parse(mapAppHealthResultToDTO({ ok: false, error: message })),
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
