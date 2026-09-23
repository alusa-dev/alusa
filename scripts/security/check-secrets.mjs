import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

// Keep this scan intentionally high-confidence. Test fixtures use short, named
// placeholders; long provider-shaped values and private keys must never land in
// the public repository, regardless of whether they are in source, docs, or CI.
const detectors = [
  { name: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { name: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{32,}\b/g },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  {
    name: 'credentialed connection string',
    pattern: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s:@]+:[^\s@]{16,}@(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/))/g,
  },
];

const findings = [];
for (const relativeFile of trackedFiles) {
  const absoluteFile = path.join(root, relativeFile);
  // Deleted paths remain in `git ls-files` until the next index update. They
  // have no worktree contents to scan; staged additions are checked after they
  // enter the index, and removed files are represented by their deletion.
  if (!fs.existsSync(absoluteFile)) continue;
  const contents = fs.readFileSync(absoluteFile);
  if (contents.includes(0)) continue;

  const source = contents.toString('utf8');
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of source.matchAll(detector.pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({ file: relativeFile, line, detector: detector.name });
    }
  }
}

if (findings.length > 0) {
  console.error('[security-secrets] FALHOU: possível segredo versionado detectado.');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.detector}); remova o valor e use o secret manager.`);
  }
  process.exitCode = 1;
} else {
  console.log(`[security-secrets] OK: ${trackedFiles.length} arquivos versionados auditados.`);
}
