import { updateSchoolAddressInputDTOSchema, userSchoolAddressDTOSchema } from '@/features/users/dtos';
import { jsonNoStore } from '@/lib/http-security';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getSchoolAddress, updateSchoolAddress } from '@/src/server/users/user-account.service';

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    const { contaId } = auth;

    const conta = await getSchoolAddress(contaId);
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
    if (!contaId) {
      return jsonNoStore({ error: 'Conta não encontrada' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonNoStore({ error: 'Corpo inválido' }, { status: 400 });
    }

    const parsed = updateSchoolAddressInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore({ error: parsed.error.flatten() }, { status: 422 });
    }

    const data = parsed.data;
    const updated = await updateSchoolAddress({ contaId, ...data });
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
