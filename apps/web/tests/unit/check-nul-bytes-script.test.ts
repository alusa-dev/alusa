/**
 * Testa o script de CI para detectar bytes NUL.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runNodeScript(
  repoRoot: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'pipe', cwd: repoRoot });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));

    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('scripts/check-nul-bytes.mjs', () => {
  it('falha (exit 1) quando encontra byte NUL', async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'alusa-nul-bytes-'));

    try {
      await mkdir(path.join(tmpRoot, 'nested'), { recursive: true });
      await writeFile(path.join(tmpRoot, 'nested', 'bad.ts'), Buffer.from([0x00, 0x61]));

      const repoRoot = path.resolve(process.cwd(), '../..');
      const scriptPath = path.join(repoRoot, 'scripts', 'check-nul-bytes.mjs');

      const result = await runNodeScript(repoRoot, [scriptPath, tmpRoot]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('bytes NUL');
      expect(result.stderr).toContain('bad.ts');
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('passa (exit 0) quando não encontra byte NUL', async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'alusa-nul-bytes-'));

    try {
      await writeFile(path.join(tmpRoot, 'ok.ts'), 'export const ok = true;\n', 'utf8');

      const repoRoot = path.resolve(process.cwd(), '../..');
      const scriptPath = path.join(repoRoot, 'scripts', 'check-nul-bytes.mjs');

      const result = await runNodeScript(repoRoot, [scriptPath, tmpRoot]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('OK:');
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
