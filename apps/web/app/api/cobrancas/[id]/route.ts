import type { NextRequest } from 'next/server';

import { getCobrancaDetailRoute } from '@/src/server/finance/cobranca-detail-http-route.service';
import {
  deleteCobrancaRoute,
  updateCobrancaRoute,
} from '@/src/server/finance/cobranca-command-http.service';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return getCobrancaDetailRoute(req, context);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return updateCobrancaRoute(req, context);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return deleteCobrancaRoute(req, context);
}
