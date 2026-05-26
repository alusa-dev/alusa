import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/prisma';
import {
  AsaasHttpError,
  asaasCreateCustomer,
  asaasGetCustomer,
  asaasListCustomers,
} from '@alusa/finance';
import { loadAsaasCredentials } from '@alusa/database';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  adminTestCustomerQueryDTOSchema,
  adminTestCustomerResultDTOSchema,
} from '@/features/system/dtos';
import { mapAdminTestCustomerResultToDTO } from '@/features/system/mappers';

export const dynamic = 'force-dynamic';

const TEST_CPF = '11144477735';
const TEST_EMAIL_DOMAIN = 'alusa.local';
const TEST_PHONE = '11900000000';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedQuery = adminTestCustomerQueryDTOSchema.safeParse({
      contaId: searchParams.get('contaId') || undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'contaId inválido' }, { status: 400 });
    }

    const tenantScope = await resolveTenantScope(request, {
      requestedContaId: parsedQuery.data.contaId ?? null,
    });
    if (!tenantScope.ok) {
      const status = tenantScope.response.status;
      if (status === 401) {
        return NextResponse.json({ error: 'Não autenticado' }, { status });
      }
      if (status === 403) {
        return NextResponse.json({ error: 'Não autorizado' }, { status });
      }
      return NextResponse.json({ error: 'contaId inválido' }, { status });
    }

    const contaId = tenantScope.contaId || '';

    if (!contaId) {
      return NextResponse.json({ error: 'contaId é obrigatório' }, { status: 400 });
    }

    const profile = await prisma.financeProfile.findUnique({
      where: { contaId },
      select: { asaasAccountId: true, asaasCredential: { select: { apiKeyEncrypted: true } } },
    });

    if (!profile?.asaasCredential?.apiKeyEncrypted) {
      return NextResponse.json({ error: 'Conta de pagamentos não configurada' }, { status: 412 });
    }

    const credentials = await loadAsaasCredentials(contaId);
    if (!credentials?.apiKey) {
      return NextResponse.json({ error: 'Conta de pagamentos não configurada' }, { status: 412 });
    }

    const steps: string[] = [];
    const list = await asaasListCustomers({
      apiKey: credentials.apiKey,
      cpfCnpj: TEST_CPF,
      limit: 1,
    });
    steps.push('LIST_CUSTOMERS');

    let customer = list.data?.find((item) => !item.deleted) ?? list.data?.[0] ?? null;
    const externalReference = `sandbox-test:${contaId}`;

    if (!customer) {
      customer = await asaasCreateCustomer({
        apiKey: credentials.apiKey,
        idempotencyKey: externalReference,
        data: {
          name: 'Sandbox Teste',
          cpfCnpj: TEST_CPF,
          email: `sandbox+${contaId}@${TEST_EMAIL_DOMAIN}`,
          phone: TEST_PHONE,
          externalReference,
        },
      });
      steps.push('CREATE_CUSTOMER');
    }

    const verified = await asaasGetCustomer({
      apiKey: credentials.apiKey,
      customerId: customer.id,
    });
    steps.push('GET_CUSTOMER');

    return NextResponse.json(
      adminTestCustomerResultDTOSchema.parse(
        mapAdminTestCustomerResultToDTO({
          ok: true,
          asaasCustomerId: verified.id,
          usedSubaccountId: profile?.asaasAccountId ?? null,
          usedPayer: 'TEST',
          steps,
        }),
      ),
    );
  } catch (error) {
    console.error('[admin/asaas/test-customer] Erro:', error);
    return NextResponse.json(
      adminTestCustomerResultDTOSchema.parse(
        mapAdminTestCustomerResultToDTO({
          ok: false,
          error: 'Falha ao validar integração de pagamentos.',
        }),
      ),
      { status: 500 },
    );
  }
}
