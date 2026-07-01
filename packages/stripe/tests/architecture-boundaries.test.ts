import { execSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../');

function rg(pattern: string, searchPath: string): string[] {
  const output = execSync(`rg -l "${pattern}" "${searchPath}" --glob '*.ts' 2>/dev/null || true`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('@alusa/stripe architecture boundaries', () => {
  it('não importa Asaas, finance, database ou Prisma', () => {
    expect(
      rg("from '@alusa/(asaas|asaas-gateway|finance|database)'|from '@prisma/client'", 'packages/stripe/src'),
    ).toEqual([]);
  });
});
