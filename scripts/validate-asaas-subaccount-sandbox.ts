import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

function loadEnvFileIfPresent(relativePath: string) {
  try {
    const absolutePath = resolvePath(process.cwd(), relativePath);
    const content = readFileSync(absolutePath, 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (!key) continue;
      if (process.env[key]) continue;

      const unquoted = rawValue.replace(/^['"]|['"]$/g, '');
      process.env[key] = unquoted;
    }
  } catch {
    // ignore
  }
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function calculateCnpjCheckDigit(baseDigits: number[], weights: number[]): number {
  const sum = baseDigits.reduce((acc, digit, index) => acc + digit * weights[index]!, 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

function generateValidCnpj(): string {
  // Formato base: 12 dígitos (8 raiz + 4 filial). Usamos filial 0001.
  const root = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const branch = [0, 0, 0, 1];
  const base = [...root, ...branch];

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calculateCnpjCheckDigit(base, weights1);

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d2 = calculateCnpjCheckDigit([...base, d1], weights2);

  return [...base, d1, d2].join('');
}

async function cleanup(contaId: string) {
  const { prisma } = await import('../packages/database/dist/index.js');
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  await prisma.auditLog.deleteMany({ where: { contaId } });

  if (profile) {
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
  }

  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

function assertEnv() {
  // Se o script for rodado sem `dotenv -e ...`, tenta carregar envs comuns.
  loadEnvFileIfPresent('apps/web/.env.local');
  loadEnvFileIfPresent('.env.local');

  const apiKey = process.env.ASAAS_API_KEY;
  const baseUrl = process.env.ASAAS_BASE_URL;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!apiKey) throw new Error('ASAAS_API_KEY ausente (verifique apps/web/.env.local)');
  if (!baseUrl) throw new Error('ASAAS_BASE_URL ausente (verifique apps/web/.env.local)');
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY ausente (verifique apps/web/.env.local)');

  return { apiKey, baseUrl, encryptionKey };
}

async function main() {
  const { apiKey, baseUrl } = assertEnv();

  console.log('[asaas] ASAAS_API_KEY presente (não exibida)');
  console.log('[asaas] ASAAS_BASE_URL:', baseUrl);

  const unique = randomUUID();

  const { prisma } = await import('../packages/database/dist/index.js');
  const { financeProfileService, createAsaasAccount } = await import('../packages/finance/dist/index.js');
  const typedFinanceProfileService = financeProfileService as {
    setOnboardingData: (contaId: string, data: {
      mobilePhone: string;
      incomeValue: number;
      address: string;
      addressNumber: string;
      province: string;
      postalCode: string;
    }) => Promise<void>;
  };

  const typedCreateAsaasAccount = createAsaasAccount as (params: {
    contaId: string;
    actor?: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
  }) => Promise<{ asaasAccountId: string | null }>;

  const conta = await prisma.conta.create({
    data: {
      nome: `Conta Sandbox ${unique.slice(0, 8)}`,
      cpfCnpj: generateValidCnpj(),
    },
  });

  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Owner',
      email: `owner+${unique}@teste.com`,
      senhaHash: 'hash',
      role: 'ADMIN',
    },
  });

  try {
    await typedFinanceProfileService.setOnboardingData(conta.id, {
      mobilePhone: '11987654321',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001000',
    });

    console.log('[asaas] Criando subconta no sandbox...');

    const first = await typedCreateAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } });
    const second = await typedCreateAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } });

    console.log('[asaas] createAsaasAccount#1 asaasAccountId:', first.asaasAccountId);
    console.log('[asaas] createAsaasAccount#2 asaasAccountId:', second.asaasAccountId);

    if (!first.asaasAccountId) {
      throw new Error('Falha: asaasAccountId veio nulo mesmo com profile completo');
    }

    if (first.asaasAccountId !== second.asaasAccountId) {
      throw new Error('Falha: idempotência quebrou (asaasAccountId mudou entre chamadas)');
    }

    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
    if (!profile) throw new Error('FinanceProfile não encontrado após provisionamento');

    const record = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: profile.id },
      select: { asaasAccountId: true, status: true },
    });

    console.log('[db] asaasAccount.asaasAccountId:', record?.asaasAccountId);
    console.log('[db] asaasAccount.status:', record?.status);

    if (record?.asaasAccountId !== first.asaasAccountId) {
      throw new Error('Falha: asaasAccountId não persistiu corretamente no banco');
    }

    console.log('✅ OK: Subconta criada no Asaas sandbox e persistida no banco (idempotente)');
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AsaasHttpError' &&
      'status' in err
    ) {
      console.error('❌ Erro retornado pelo Asaas');
      console.error('status:', (err as { status?: unknown }).status);
      console.error('message:', (err as { message?: unknown }).message);
      console.error('response:', JSON.stringify((err as { response?: unknown }).response, null, 2));
      process.exitCode = 1;
      return;
    }

    console.error('❌ Erro na validação');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup(conta.id);
  }
}

await main();
