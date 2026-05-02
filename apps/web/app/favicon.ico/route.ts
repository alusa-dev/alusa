import { NextResponse } from 'next/server';

export function GET(request: Request) {
  return NextResponse.redirect(new URL('/favicon.svg', request.url), {
    status: 308,
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
