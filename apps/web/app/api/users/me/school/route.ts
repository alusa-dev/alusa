import prisma from '@/lib/prisma';
import { updateSchoolInputDTOSchema, userSchoolSummaryDTOSchema } from '@/features/users/dtos';
import { jsonNoStore } from '@/lib/http-security';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { normalizeAccountTimeZone } from '@/src/server/aulas/calendar/account-timezone';

export async function PATCH(req: Request) {
  try {
    const tenantScope = await resolveTenantScope(req, { requireAdmin: true });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    const contaId = tenantScope.contaId;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonNoStore({ error: 'Corpo inválido' }, { status: 400 });
    }

    const parsed = updateSchoolInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore({ error: parsed.error.flatten() }, { status: 422 });
    }

    const input = parsed.data;
    const data: Record<string, unknown> = {};
    if (typeof input.name !== 'undefined') data.nome = input.name;
    if (typeof input.cpfCnpj !== 'undefined') data.cpfCnpj = input.cpfCnpj.replace(/\D/g, '');
    if (typeof input.timezone !== 'undefined') data.timezone = normalizeAccountTimeZone(input.timezone);

    if (Object.keys(data).length === 0) {
      return jsonNoStore(
        { error: { formErrors: ['Nenhuma alteração fornecida'] } },
        { status: 400 },
      );
    }

    const updated = await prisma.conta.update({
      where: { id: contaId },
      data: data as any,
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        status: true,
        ownerUserId: true,
        timezone: true,
      },
    });

    return jsonNoStore(
      userSchoolSummaryDTOSchema.parse({
        id: updated.id,
        name: updated.nome,
        cpfCnpj: updated.cpfCnpj,
        status: updated.status,
        ownerUserId: updated.ownerUserId,
        timezone: updated.timezone ?? 'America/Sao_Paulo',
      }),
    );
  } catch (error) {
    console.error('Error updating school:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
