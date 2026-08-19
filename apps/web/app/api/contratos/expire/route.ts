import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { expireContratosResultDTOSchema } from '@/features/contratos/dtos';
import { expireContractSignatureLinks } from '@/src/server/contracts/expire-contract-signature-links.service';

export async function POST(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const result = await expireContractSignatureLinks(
      { contaId: user.contaId, limit: 500 },
      { prisma },
    );
    return NextResponse.json(expireContratosResultDTOSchema.parse({ updated: result.atualizados }));
  } catch (error) {
    console.error('[CONTRATOS_EXPIRE]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao expirar contratos' } },
      { status: 500 },
    );
  }
}
