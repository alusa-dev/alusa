import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  deleteContratoModeloResultDTOSchema,
  updateContratoModeloInputDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoModeloRecordToDTO } from '@/features/contratos/mappers';
import {
  deleteContractModelForTenant,
  getContractModelForTenant,
  updateContractModelForTenant,
} from '@/src/server/contracts/contract-model.service';

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const modelo = await getContractModelForTenant({ contaId: user.contaId, id: (await params).id });
    if (!modelo) return NextResponse.json({ error: { message: 'Modelo não encontrado' } }, { status: 404 });
    return NextResponse.json(mapContratoModeloRecordToDTO(modelo));
  } catch (error) {
    console.error('[MODELO_GET]', error);
    return NextResponse.json({ error: { message: 'Erro ao buscar modelo' } }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const body = updateContratoModeloInputDTOSchema.parse(await request.json());
    const result = await updateContractModelForTenant({ contaId: user.contaId, id: (await params).id, body });
    if (result.status === 'NOT_FOUND') return NextResponse.json({ error: { message: 'Modelo não encontrado' } }, { status: 404 });
    if (result.status === 'DUPLICATE_NAME') return NextResponse.json({ error: { message: 'Já existe um modelo ativo com esse nome' } }, { status: 409 });
    if (result.status === 'INVALID_TEMPLATE') return NextResponse.json({ error: { message: 'Template de consentimento inválido' } }, { status: 400 });
    return NextResponse.json(mapContratoModeloRecordToDTO(result.modelo));
  } catch (error) {
    console.error('[MODELO_PUT]', error);
    return NextResponse.json({ error: { message: 'Erro ao atualizar modelo' } }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const result = await deleteContractModelForTenant({ contaId: user.contaId, id: (await params).id });
    if (result.status === 'NOT_FOUND') return NextResponse.json({ error: { message: 'Modelo não encontrado' } }, { status: 404 });
    return NextResponse.json(deleteContratoModeloResultDTOSchema.parse(
      result.status === 'INACTIVATED'
        ? { message: 'Modelo inativado (possui contratos vinculados)', inactivated: true }
        : { message: 'Modelo excluído com sucesso' },
    ));
  } catch (error) {
    console.error('[MODELO_DELETE]', error);
    return NextResponse.json({ error: { message: 'Erro ao excluir modelo' } }, { status: 500 });
  }
}
