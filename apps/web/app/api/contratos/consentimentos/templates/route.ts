import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { listContratoConsentimentoTemplatesResultDTOSchema } from '@/features/contratos/dtos';
import { listActiveConsentimentoTemplates } from '@/src/server/contracts/consentimento-template.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });

  try {
    const templates = await listActiveConsentimentoTemplates(user.contaId);

    return NextResponse.json(listContratoConsentimentoTemplatesResultDTOSchema.parse(templates));
  } catch (error) {
    console.error('[CONTRATO_CONSENTIMENTO_TEMPLATES_GET]', error);
    return NextResponse.json({ error: { message: 'Erro ao listar templates de consentimento' } }, { status: 500 });
  }
}
