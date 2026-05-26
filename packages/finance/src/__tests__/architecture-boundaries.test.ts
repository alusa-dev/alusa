import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
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
      ['sync-aluno-asaas.ts.disabled'],
    );
  });
});
