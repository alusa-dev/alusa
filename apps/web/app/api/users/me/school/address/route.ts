import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { updateSchoolAddressInputDTOSchema, userSchoolAddressDTOSchema } from '@/features/users/dtos';
import { jsonNoStore } from '@/lib/http-security';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId || null;
    if (!contaId) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });

    const conta = await prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        enderecoLogradouro: true,
        enderecoNumero: true,
        enderecoBairro: true,
        enderecoCidade: true,
        enderecoUf: true,
        enderecoCep: true,
      } as any,
    });
    if (!conta) return jsonNoStore({ error: 'Conta não encontrada' }, { status: 404 });
    return jsonNoStore(
      userSchoolAddressDTOSchema.parse({
        street: conta.enderecoLogradouro ?? '',
        number: conta.enderecoNumero ?? '',
        district: conta.enderecoBairro ?? '',
        city: conta.enderecoCidade ?? '',
        state: conta.enderecoUf ?? '',
        cep: conta.enderecoCep ?? '',
      }),
    );
  } catch (error) {
    console.error('Error reading school address:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    const parsed = updateSchoolAddressInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore({ error: parsed.error.flatten() }, { status: 422 });
    }

    const data = parsed.data;
    const updated = await prisma.conta.update({
      where: { id: contaId },
      data: {
        enderecoLogradouro: typeof data.street === 'string' ? data.street : undefined,
        enderecoNumero: typeof data.number === 'string' ? data.number : undefined,
        enderecoBairro: typeof data.district === 'string' ? data.district : undefined,
        enderecoCidade: typeof data.city === 'string' ? data.city : undefined,
        enderecoUf: typeof data.state === 'string' ? data.state.toUpperCase() : undefined,
        enderecoCep: typeof data.cep === 'string' ? data.cep.replace(/\D/g, '') : undefined,
      } as any,
      select: {
        enderecoLogradouro: true,
        enderecoNumero: true,
        enderecoBairro: true,
        enderecoCidade: true,
        enderecoUf: true,
        enderecoCep: true,
      } as any,
    });
    return jsonNoStore(
      userSchoolAddressDTOSchema.parse({
        street: updated.enderecoLogradouro ?? '',
        number: updated.enderecoNumero ?? '',
        district: updated.enderecoBairro ?? '',
        city: updated.enderecoCidade ?? '',
        state: updated.enderecoUf ?? '',
        cep: updated.enderecoCep ?? '',
      }),
    );
  } catch (error) {
    console.error('Error updating school address:', error);
    const msg = (error as Error)?.message || '';
    if (/Unknown arg|Unknown field|column .* does not exist/i.test(msg)) {
      return jsonNoStore(
        { error: 'Campos de endereço não encontrados. Rode a migration do banco.' },
        { status: 500 },
      );
    }
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
