import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../');

function rg(pattern: string, searchPath: string): string[] {
  const matcher = new RegExp(pattern);
  const absoluteRoot = path.resolve(repoRoot, searchPath);
  const matches: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && matcher.test(readFileSync(absolutePath, 'utf8'))) {
        matches.push(path.relative(repoRoot, absolutePath));
      }
    }
  }

  visit(absoluteRoot);
  return matches;
}

describe('@alusa/platform-billing architecture boundaries', () => {
  it('não importa Asaas, finance ou database', () => {
    expect(
      rg(
        "from '@alusa/(asaas|asaas-gateway|finance|database)'",
        'packages/platform-billing/src',
      ),
    ).toEqual([]);
  });

  it('limita Prisma ao store de persistência', () => {
    expect(rg("from '@prisma/client'", 'packages/platform-billing/src')).toEqual([
      'packages/platform-billing/src/prisma-store.ts',
    ]);
  });
});
