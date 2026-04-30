import { NextResponse } from 'next/server';
import { disabledRegisterResultDTOSchema } from '@/features/users/dtos';

// Endpoint desativado por política de negócio

export async function POST() {
  // Registro direto desativado: cadastros devem ocorrer via:
  // - first-register (ADMIN) quando não há token
  // - accept (convite) quando há token/link
  return NextResponse.json(
    disabledRegisterResultDTOSchema.parse({
      error: 'Fluxo desativado. Use /api/users/first-register (ADMIN) ou /api/users/accept (convite).',
    }),
    { status: 400 }
  );
}
