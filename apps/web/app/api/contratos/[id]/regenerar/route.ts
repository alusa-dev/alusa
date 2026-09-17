import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { contratoDTOSchema, contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';
import { regenerateContractLinkForTenant } from '@/src/server/contracts/contract-read.service';

export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user?.contaId) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const { id } = contratoRouteParamsDTOSchema.parse(await params);
    const result = await regenerateContractLinkForTenant({ contaId: user.contaId, contractId: id, actorId: user.id });
    if (result.status === 'NOT_FOUND' || result.status === 'NOT_FOUND_AFTER_REGENERATION') return NextResponse.json({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    if (result.status === 'NOT_REGENERATABLE') return NextResponse.json({ error: { message: 'Não é possível regenerar link para este contrato' } }, { status: 400 });
    return NextResponse.json(contratoDTOSchema.parse(mapContratoRecordToDTO(result.contrato, { publicToken: result.tokenPublico })));
  } catch (error) {
    console.error('[CONTRATO_REGENERAR]', error);
    return NextResponse.json({ error: { message: 'Erro ao regenerar link do contrato' } }, { status: 500 });
  }
}
