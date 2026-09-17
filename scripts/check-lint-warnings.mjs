import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'docs/quality/eslint-warning-baseline.json');

function parseJsonArrays(output) {
  const arrays = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        arrays.push(JSON.parse(output.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  return arrays.flat();
}

function runLint() {
  return spawnSync('pnpm', ['-r', 'exec', 'eslint', '.', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function summarize(results) {
  const byRule = new Map();
  let warningCount = 0;
  let errorCount = 0;
  let files = 0;

  for (const result of results) {
    files += 1;
    warningCount += result.warningCount ?? 0;
    errorCount += result.errorCount ?? 0;
    for (const message of result.messages ?? []) {
      if (message.severity !== 1) continue;
      const rule = message.ruleId ?? 'unknown';
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    }
  }

  return {
    files,
    warningCount,
    errorCount,
    warningsByRule: Object.fromEntries([...byRule.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const result = runLint();
const parsedResults = parseJsonArrays(result.stdout ?? '');
if (parsedResults.length === 0) {
  console.error('[lint-ratchet] FALHOU: não foi possível interpretar a saída JSON do ESLint.');
  if (result.error) console.error(`- ${result.error.message}`);
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const summary = summarize(parsedResults);
const serialized = `${JSON.stringify({ generatedAt: 'deterministic', ...summary }, null, 2)}\n`;

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, serialized, 'utf8');
  console.log(`[lint-ratchet] escrito ${path.relative(root, baselinePath)}`);
} else if (!fs.existsSync(baselinePath)) {
  console.error(`[lint-ratchet] FALHOU: baseline ausente ${path.relative(root, baselinePath)}.`);
  process.exitCode = 1;
} else {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const failures = [];
  if (summary.errorCount > 0) failures.push(`ESLint encontrou ${summary.errorCount} erro(s).`);
  if (summary.warningCount > (baseline.warningCount ?? 0)) {
    failures.push(`warnings aumentaram (${summary.warningCount} > ${baseline.warningCount}).`);
  }
  for (const [rule, count] of Object.entries(summary.warningsByRule)) {
    const baselineCount = baseline.warningsByRule?.[rule] ?? 0;
    if (count > baselineCount) failures.push(`warnings da regra ${rule} aumentaram (${count} > ${baselineCount}).`);
  }
  if (failures.length > 0) {
    console.error('[lint-ratchet] FALHOU: regressão de lint.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

console.log(`[lint-ratchet] files=${summary.files}`);
console.log(`[lint-ratchet] errors=${summary.errorCount}`);
console.log(`[lint-ratchet] warnings=${summary.warningCount}`);
