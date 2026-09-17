import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { contratoRouteParamsDTOSchema, deleteContratoResultDTOSchema } from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';
import { cancelContractForTenant, getContractForTenant } from '@/src/server/contracts/contract-read.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const { id } = contratoRouteParamsDTOSchema.parse(await params);
    const contrato = await getContractForTenant({ id, contaId: user.contaId });
    if (!contrato) return NextResponse.json({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    return NextResponse.json(mapContratoRecordToDTO(contrato));
  } catch (error) {
    console.error('[CONTRATO_GET]', error);
    return NextResponse.json({ error: { message: 'Erro ao buscar contrato' } }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const { id } = contratoRouteParamsDTOSchema.parse(await params);
    const result = await cancelContractForTenant({ contractId: id, contaId: user.contaId, actorId: user.id });
    if (result.status === 'NOT_FOUND') return NextResponse.json({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    if (result.status === 'NOT_CANCELLABLE') return NextResponse.json({ error: { message: 'Não é possível cancelar um contrato já assinado' } }, { status: 400 });
    if (result.status === 'CONCURRENT_CHANGE') return NextResponse.json({ error: { message: 'O contrato já foi alterado por outra operação.' } }, { status: 409 });
    return NextResponse.json(deleteContratoResultDTOSchema.parse({ message: 'Contrato cancelado com sucesso' }));
  } catch (error) {
    console.error('[CONTRATO_DELETE]', error);
    return NextResponse.json({ error: { message: 'Erro ao cancelar contrato' } }, { status: 500 });
  }
}
