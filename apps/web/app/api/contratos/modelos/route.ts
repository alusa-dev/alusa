import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import {
  createContratoModeloInputDTOSchema,
  listContratoModelosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoModeloRecordToDTO } from '@/features/contratos/mappers';
import { createContractModelForTenant, listContractModelsForTenant } from '@/src/server/contracts/contract-model.service';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const status = new URL(request.url).searchParams.get('status');
    const models = await listContractModelsForTenant({
      contaId: user.contaId,
      status: status === 'ATIVO' || status === 'INATIVO' ? status : undefined,
    });
    return NextResponse.json(listContratoModelosResultDTOSchema.parse(models.map(mapContratoModeloRecordToDTO)));
  } catch (error) {
    console.error('[MODELOS_GET]', error);
    return NextResponse.json({ error: { message: 'Erro ao listar modelos de contrato' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  try {
    const body = createContratoModeloInputDTOSchema.parse(await request.json());
    const result = await createContractModelForTenant({ contaId: user.contaId, body });
    if (result.status === 'INVALID_TEMPLATE') {
      return NextResponse.json({ error: { message: 'Template de consentimento inválido' } }, { status: 400 });
    }
    if (result.status === 'DUPLICATE_NAME') {
      return NextResponse.json({ error: { message: 'Já existe um modelo ativo com esse nome' } }, { status: 409 });
    }
    return NextResponse.json(mapContratoModeloRecordToDTO(result.modelo), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: { message: error.errors[0]?.message ?? 'Dados inválidos', details: error.errors } }, { status: 400 });
    }
    console.error('[MODELOS_POST]', error);
    return NextResponse.json({ error: { message: 'Erro ao criar modelo de contrato' } }, { status: 500 });
  }
}
