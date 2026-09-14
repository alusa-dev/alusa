import { NextResponse } from 'next/server';
import { z } from 'zod';

import { revokeMobileSession } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

const logoutSchema = z.object({ refreshToken: z.string().min(1).max(512) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = logoutSchema.safeParse(body);
  if (parsed.success) await revokeMobileSession(parsed.data.refreshToken);
  return new NextResponse(null, { status: 204 });
}
