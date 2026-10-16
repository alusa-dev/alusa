import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGlobalCronAuth,
  validateTerminalContext,
  validateWorkStatusCompletion,
} from './job-contract-terminal-context.mjs';

const route = '/api/jobs/example';

test('accepts the start context on every terminal log call without requiring a failure logger', () => {
  const source = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 });
  `;

  assert.deepEqual(validateTerminalContext(source, route), []);
});

test('accepts a start context assigned after tenant authorization', () => {
  const source = `
    let startedAt;
    if (authorized) {
      startedAt = startJobRun('example');
      logJobResult('example', startedAt, { count: 1 });
    }
  `;

  assert.deepEqual(validateTerminalContext(source, route), []);
});

test('rejects multiple start contexts assigned across branches', () => {
  const source = `
    let startedAt;
    if (authorized) startedAt = startJobRun('example');
    else startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 });
  `;

  assert.match(validateTerminalContext(source, route).join('\n'), /exatamente um contexto/);
});

test('rejects a terminal log call that omits the start context', () => {
  const source = `
    const startedAt = startJobRun('example');
    logJobResult('example');
  `;

  assert.match(validateTerminalContext(source, route).join('\n'), /sem contexto de execução/);
});

test('rejects a divergent context passed to a terminal log call', () => {
  const source = `
    const startedAt = startJobRun('example');
    const otherContext = { startedAt: Date.now() };
    logJobResult('example', otherContext, { count: 1 });
  `;

  assert.match(validateTerminalContext(source, route).join('\n'), /contexto divergente/);
});

test('checks context propagation on failure logs when present', () => {
  const source = `
    const startedAt = startJobRun('example');
    try { run(); } catch (error) { logJobFailure('example', startedAt, error); }
  `;

  assert.deepEqual(validateTerminalContext(source, route), []);
});

test('requires workStatus on every scheduled route completion call', () => {
  const source = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 }, { workStatus: 'worked' });
  `;

  assert.deepEqual(validateWorkStatusCompletion(source, route), []);

  const shorthand = `
    const startedAt = startJobRun('example');
    const workStatus = 'empty';
    logJobResult('example', startedAt, { count: 0 }, { workStatus });
  `;
  assert.deepEqual(validateWorkStatusCompletion(shorthand, route), []);
});

test('rejects missing or incomplete workStatus completion classification', () => {
  const missing = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 });
  `;
  const oneBranchMissing = `
    const startedAt = startJobRun('example');
    if (done) logJobResult('example', startedAt, { count: 1 }, { workStatus: 'worked' });
    else logJobResult('example', startedAt, { count: 0 });
  `;
  const classificationOnlyInResult = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1, workStatus: 'worked' }, { note: 'done' });
  `;
  const onlyString = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 }, { note: 'workStatus: worked' });
  `;
  const onlyTemplateString = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 }, { note: \`workStatus: worked\` });
  `;
  const onlyEscapedString = String.raw`
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 1 }, { note: "escaped quote \" workStatus: worked" });
  `;
  const onlyComment = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 0 }, { /* workStatus: empty */ });
  `;
  const invalidLiteral = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, { count: 0 }, { workStatus: 'skipped' });
  `;

  assert.match(validateWorkStatusCompletion(missing, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(oneBranchMissing, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(classificationOnlyInResult, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(onlyString, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(onlyTemplateString, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(onlyEscapedString, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(onlyComment, route).join('\n'), /workStatus/);
  assert.match(validateWorkStatusCompletion(invalidLiteral, route).join('\n'), /workStatus inválido/);

  const conditionalWithOtherStringLiteral = `
    const startedAt = startJobRun('example');
    logJobResult('example', startedAt, {}, {
      workStatus: result.outcome !== 'completed' ? 'unknown' : scanned > 0 ? 'worked' : 'empty',
    });
  `;
  assert.deepEqual(validateWorkStatusCompletion(conditionalWithOtherStringLiteral, route), []);
});

test('accepts executable global cron token validation and a 401 rejection', () => {
  const source = `
    async function run(req) {
      const configuredCronToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
      const bearerToken = req.headers.get('authorization');
      const cronToken = req.headers.get('x-cron-token');
      if (!configuredCronToken || (cronToken !== configuredCronToken && bearerToken !== configuredCronToken)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ success: true });
    }
  `;

  assert.deepEqual(validateGlobalCronAuth(source, route), []);
});

test('rejects global cron auth patterns that appear only in comments or strings', () => {
  const source = `
    // const configuredCronToken = process.env.CRON_SECRET;
    // const bearerToken = req.headers.get('authorization');
    // const cronToken = req.headers.get('x-cron-token');
    // if (cronToken !== configuredCronToken && bearerToken !== configuredCronToken) return NextResponse.json({}, { status: 401 });
    const note = "configuredCronToken = process.env.CRON_SECRET; req.headers.get('authorization'); req.headers.get('x-cron-token'); cronToken !== configuredCronToken; bearerToken !== configuredCronToken; status: 401";
  `;

  assert.match(validateGlobalCronAuth(source, route).join('\n'), /CRON_SECRET.*401/);
});

test('rejects actual checks when the 401 response is outside the credential rejection branch', () => {
  const source = `
    const configuredCronToken = process.env.CRON_SECRET;
    const bearerToken = req.headers.get('authorization');
    const cronToken = req.headers.get('x-cron-token');
    if (!configuredCronToken || (cronToken !== configuredCronToken && bearerToken !== configuredCronToken)) {
      throw new Error('unauthorized');
    }
    return NextResponse.json({}, { status: 401 });
  `;

  assert.match(validateGlobalCronAuth(source, route).join('\n'), /CRON_SECRET.*401/);
});

test('rejects a nested conditional 401 with a successful alternate rejection path', () => {
  const source = `
    const configuredCronToken = process.env.CRON_SECRET;
    const bearerToken = req.headers.get('authorization');
    const cronToken = req.headers.get('x-cron-token');
    if (!configuredCronToken || (cronToken !== configuredCronToken && bearerToken !== configuredCronToken)) {
      if (mustReject) return NextResponse.json({}, { status: 401 });
      return NextResponse.json({ success: true }, { status: 200 });
    }
  `;

  assert.match(validateGlobalCronAuth(source, route).join('\n'), /CRON_SECRET.*401/);
});

test('rejects token comparisons that are not combined into the rejection condition', () => {
  const source = `
    const configuredCronToken = process.env.CRON_SECRET;
    const bearerToken = req.headers.get('authorization');
    const cronToken = req.headers.get('x-cron-token');
    if (!configuredCronToken || cronToken !== configuredCronToken || bearerToken !== configuredCronToken) {
      return NextResponse.json({}, { status: 401 });
    }
  `;

  assert.match(validateGlobalCronAuth(source, route).join('\n'), /CRON_SECRET.*401/);
});
