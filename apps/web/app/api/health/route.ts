import { NextRequest, NextResponse } from 'next/server';
import { appHealthResultDTOSchema } from '@/features/system/dtos';
import { mapAppHealthResultToDTO } from '@/features/system/mappers';
import { NO_STORE_HEADERS } from '@/lib/http-security';
import { checkDatabaseConnectivity, ensureDevelopmentHealthFixture } from '@/src/server/system/health.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const lite = req.nextUrl.searchParams.get('lite') === '1';

    // Upsert da conta demo em ambientes de desenvolvimento/teste (não no ping leve do layout)
    if (process.env.NODE_ENV !== 'production' && !lite) {
      // 1) Garante a conta antes do usuário para evitar P2003 (FK)
      const conta = await ensureDevelopmentHealthFixture();
      return NextResponse.json(
        appHealthResultDTOSchema.parse(
          mapAppHealthResultToDTO({ ok: true, conta: { id: conta.id, nome: conta.nome } }),
        ),
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // Em produção, apenas um ping leve ao banco
    await checkDatabaseConnectivity();
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
