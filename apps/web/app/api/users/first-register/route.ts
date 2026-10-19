import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'O cadastro público está temporariamente indisponível. Entre na lista de espera ou aceite um convite da sua escola.',
      code: 'PUBLIC_SIGNUP_CLOSED',
    },
    { status: 403 },
  );
}
