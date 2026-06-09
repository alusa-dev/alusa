import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../..');

function rg(pattern: string, searchPath: string): string[] {
  try {
    const output = execSync(
      `rg -l "${pattern}" "${searchPath}" --glob '*.ts' --glob '*.tsx' 2>/dev/null || true`,
      { cwd: repoRoot, encoding: 'utf8' },
    );
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function assertNoMatches(label: string, pattern: string, searchPath: string, allowlist: string[] = []) {
  const matches = rg(pattern, searchPath).filter((file) => !allowlist.some((allowed) => file.includes(allowed)));
  expect(matches, `${label}: ${matches.join(', ')}`).toEqual([]);
}

describe('architecture boundaries — Asaas layers', () => {
  it('@alusa/asaas não importa database, prisma ou finance', () => {
    assertNoMatches(
      'packages/asaas forbidden imports',
      "from '@alusa/(database|finance|lib)'|from '@prisma/client'",
      path.join(repoRoot, 'packages/asaas/src'),
    );
  });

  it('@alusa/asaas-gateway não importa database, prisma ou finance', () => {
    assertNoMatches(
      'packages/asaas-gateway forbidden imports',
      "from '@alusa/(database|finance|lib)'|from '@prisma/client'",
      path.join(repoRoot, 'packages/asaas-gateway/src'),
    );
  });

  it('apps/web não importa @alusa/asaas diretamente', () => {
    assertNoMatches(
      'apps/web direct @alusa/asaas imports',
      "from '@alusa/asaas'|from \"@alusa/asaas\"",
      path.join(repoRoot, 'apps/web'),
    );
  });

  it('apps/web não importa @alusa/asaas-gateway diretamente', () => {
    assertNoMatches(
      'apps/web direct @alusa/asaas-gateway imports',
      "from '@alusa/asaas-gateway'|from \"@alusa/asaas-gateway\"",
      path.join(repoRoot, 'apps/web'),
    );
  });

  it('packages/lib não importa @alusa/asaas diretamente', () => {
    assertNoMatches(
      'packages/lib direct @alusa/asaas imports',
      "from '@alusa/asaas'|from \"@alusa/asaas\"",
      path.join(repoRoot, 'packages/lib/src'),
    );
  });

  it('não reintroduz legados Billing V2 ou rotas antigas de recebimento manual', () => {
    const legacyPaths = [
      'packages/finance/src/foundation/billing-v2-flags.ts',
      'apps/web/app/api/cobrancas/[id]/confirmar-recebimento/route.ts',
      'apps/web/app/api/financeiro/cobrancas/[id]/receber-dinheiro/route.ts',
      'apps/web/tests/unit/cobrancas.confirmar-recebimento.post.test.ts',
      'apps/web/tests/unit/financeiro.cobrancas.receber-dinheiro.post.test.ts',
    ];

    expect(
      legacyPaths.filter((legacyPath) => existsSync(path.join(repoRoot, legacyPath))),
      'Arquivos legados não devem voltar; use o fluxo canônico de mark-charge-as-paid.',
    ).toEqual([]);

    assertNoMatches(
      'legacy manual payment routes',
      'Billing V2|billing-v2|billingV2|BILLING_V2|confirmar-recebimento|receber-dinheiro',
      path.join(repoRoot, 'apps/web'),
    );

    assertNoMatches(
      'legacy finance Billing V2 naming',
      'Billing V2|billing-v2|billingV2|BILLING_V2',
      path.join(repoRoot, 'packages/finance/src'),
      ['architecture-boundaries.test.ts'],
    );
  });
});
