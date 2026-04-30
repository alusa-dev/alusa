import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCredentials } from '@/lib/auth-service';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 404 });
  }
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const res = await verifyCredentials(parsed.data.email, parsed.data.password);
    if (!res) return NextResponse.json({ ok: false, reason: 'invalid_credentials' }, { status: 401 });
    return NextResponse.json({ ok: true, user: res });
  } catch {
    return NextResponse.json({ error: 'unexpected' }, { status: 500 });
  }
}
