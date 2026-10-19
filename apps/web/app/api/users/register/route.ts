import { NextResponse } from 'next/server';
import { disabledRegisterResultDTOSchema } from '@/features/users/dtos';

// Endpoint desativado por política de negócio

export async function POST() {
  return NextResponse.json(
    disabledRegisterResultDTOSchema.parse({
      error: 'Cadastro público temporariamente indisponível. Acesse /lista-de-espera ou aceite um convite da sua escola.',
    }),
    { status: 400 }
  );
}
