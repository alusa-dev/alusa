import { NextResponse } from 'next/server';

const SEAL_URLS = {
  positivo:
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
  'negativo-preto':
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Preto.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
  'negativo-branco':
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Branco.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
} as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant');
  const source =
    variant === 'negativo-preto' || variant === 'negativo-branco' || variant === 'positivo'
      ? SEAL_URLS[variant]
      : SEAL_URLS.positivo;

  const response = await fetch(source, {
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Selo Asaas indisponível.' }, { status: 502 });
  }

  const svg = await response.text();

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
