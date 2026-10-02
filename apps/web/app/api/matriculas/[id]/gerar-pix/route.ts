import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { KycNotApprovedError } from '@alusa/finance';
import {
  matriculaGerarPixResultDTOSchema,
  matriculaRouteParamsDTOSchema,
} from '@/features/enrollments/dtos';
import { mapMatriculaGerarPixResultToDTO } from '@/features/enrollments/mappers';
import { generateMatriculaPix } from '@/src/server/enrollments/enrollment-pix.service';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id: matriculaId } = matriculaRouteParamsDTOSchema.parse(await params);
    const { contaId } = auth;

    const result = await generateMatriculaPix({ matriculaId, contaId });
    if (!result.ok)
      return NextResponse.json(
        { error: result.error, ...(result.message ? { message: result.message } : {}) },
        { status: result.status },
      );

    return NextResponse.json(
      matriculaGerarPixResultDTOSchema.parse(
        mapMatriculaGerarPixResultToDTO({
          success: true,
          pixId: result.pixId,
          cobrancaId: result.cobrancaId,
          matriculaId: result.matriculaId,
          qrCode: result.qrCode,
          payload: result.payload,
          valor: result.valor,
          vencimento: result.vencimento,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
        { status: 409 },
      );
    }

    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/matriculas/[id]/gerar-pix',
      method: 'POST',
      requestId: getRequestId(_request),
      error,
    });
    return NextResponse.json({ error: 'Erro ao gerar PIX' }, { status: 500 });
  }
}
