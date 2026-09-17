import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { matriculaRouteParamsDTOSchema, matriculaProvisionamentoActionDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { getFamilyProvisioningView, retryFamilyProvisioning } from '@/src/server/matriculas/family-provisioning-http.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
function unauthorized() { return NextResponse.json({ error: { message: 'Usuário não autenticado.' } }, { status: 401 }); }
function forbidden() { return NextResponse.json({ error: { message: 'Usuário não tem permissão para reconciliar provisionamento financeiro.' } }, { status: 403 }); }
function paramsOf(context: { params: Promise<{ id: string }> }) { return context.params.then((params) => matriculaRouteParamsDTOSchema.parse(params)); }

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return unauthorized();
  if (!allowedRoles.has(String(auth.role).toUpperCase())) return forbidden();
  const { id } = await paramsOf(context);
  const view = await getFamilyProvisioningView({ familyId: id, contaId: auth.contaId });
  if (!view) return NextResponse.json({ error: { message: 'Matrícula familiar não encontrada.' } }, { status: 404 });
  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return unauthorized();
  if (!allowedRoles.has(String(auth.role).toUpperCase())) return forbidden();
  const parsed = matriculaProvisionamentoActionDTOSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Ação operacional inválida.' } }, { status: 400 });
  const { id } = await paramsOf(context);
  const view = await getFamilyProvisioningView({ familyId: id, contaId: auth.contaId });
  if (!view) return NextResponse.json({ error: { message: 'Matrícula familiar não encontrada.' } }, { status: 404 });
  const result = await retryFamilyProvisioning({ familyId: id, contaId: auth.contaId });
  if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: result.status });
  return NextResponse.json(result.result, { status: result.result.processed ? 200 : 202, headers: { 'cache-control': 'no-store' } });
}
