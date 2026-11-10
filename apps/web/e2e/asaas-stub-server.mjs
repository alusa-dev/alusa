import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.E2E_ASAAS_STUB !== 'true') {
  throw new Error('Asaas E2E stub só pode iniciar com E2E_ASAAS_STUB=true.');
}

const expectedApiKey = 'E2E_SYNTHETIC_ASAAS_KEY';
const port = Number(process.env.E2E_ASAAS_STUB_PORT ?? 9443);
const healthPort = Number(process.env.E2E_ASAAS_STUB_HEALTH_PORT ?? 9444);
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/asaas-stub');
const subscriptions = new Map();
const payments = new Map();
const webhooks = new Map();
let nextId = 1;

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const server = https.createServer({
  key: fs.readFileSync(path.join(fixtureDir, 'localhost-key.pem')),
  cert: fs.readFileSync(path.join(fixtureDir, 'localhost-cert.pem')),
}, async (request, response) => {
  const url = new URL(request.url ?? '/', `https://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    return send(response, 200, { ok: true, mode: 'e2e-only' });
  }
  if (request.headers.access_token !== expectedApiKey) {
    return send(response, 401, { errors: [{ code: 'invalid_access_token', description: 'E2E stub requires its synthetic key.' }] });
  }
  if (!url.pathname.startsWith('/v3/')) {
    return send(response, 404, { errors: [{ code: 'route_not_found', description: 'Unknown E2E stub route.' }] });
  }

  if (request.method === 'GET' && url.pathname === '/v3/myAccount') {
    return send(response, 200, { id: 'acc_e2e_local', name: 'Alusa E2E local account' });
  }
  if (request.method === 'GET' && url.pathname === '/v3/myAccount/status/') {
    return send(response, 200, {
      general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED', commercialInfo: 'APPROVED',
    });
  }
  if (request.method === 'GET' && url.pathname === '/v3/myAccount/commercialInfo/') {
    return send(response, 200, { status: 'APPROVED', personType: 'JURIDICA', name: 'Alusa E2E' });
  }
  if (request.method === 'GET' && url.pathname === '/v3/myAccount/documents') {
    return send(response, 200, { data: [] });
  }

  if (request.method === 'GET' && url.pathname === '/v3/webhooks') {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const data = [...webhooks.values()];
    return send(response, 200, {
      object: 'list', hasMore: offset + limit < data.length, totalCount: data.length,
      limit, offset, data: data.slice(offset, offset + limit),
    });
  }
  if (request.method === 'POST' && url.pathname === '/v3/webhooks') {
    let payload;
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(response, 400, { errors: [{ code: 'invalid_json', description: 'Expected JSON body.' }] });
    }
    const id = `wh_e2e_${nextId++}`;
    const webhook = {
      object: 'webhookConfig', id, name: payload.name, url: payload.url, email: payload.email,
      enabled: payload.enabled ?? true, interrupted: payload.interrupted ?? false,
      apiVersion: payload.apiVersion ?? 3, hasAuthToken: Boolean(payload.authToken),
      sendType: payload.sendType, penalizedRequestsCount: 0, events: payload.events ?? [],
    };
    webhooks.set(id, webhook);
    return send(response, 200, webhook);
  }
  const webhookMatch = url.pathname.match(/^\/v3\/webhooks\/([^/]+)$/);
  if (request.method === 'GET' && webhookMatch) {
    const webhook = webhooks.get(webhookMatch[1]);
    return webhook
      ? send(response, 200, webhook)
      : send(response, 404, { errors: [{ code: 'not_found', description: 'Webhook not found.' }] });
  }

  if (request.method === 'GET' && url.pathname === '/v3/subscriptions') {
    const reference = url.searchParams.get('externalReference');
    const data = [...subscriptions.values()].filter((item) => !reference || item.externalReference === reference);
    return send(response, 200, { object: 'list', hasMore: false, totalCount: data.length, limit: 100, offset: 0, data });
  }

  if (request.method === 'POST' && url.pathname === '/v3/subscriptions') {
    let payload;
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(response, 400, { errors: [{ code: 'invalid_json', description: 'Expected JSON body.' }] });
    }
    const id = `sub_e2e_${nextId++}`;
    const subscription = {
      object: 'subscription',
      id,
      dateCreated: new Date().toISOString().slice(0, 10),
      customer: payload.customer,
      value: payload.value,
      netValue: payload.value,
      billingType: payload.billingType,
      cycle: payload.cycle,
      description: payload.description,
      status: 'ACTIVE',
      nextDueDate: payload.nextDueDate,
      endDate: payload.endDate,
      externalReference: payload.externalReference,
      deleted: false,
    };
    subscriptions.set(id, subscription);
    const paymentId = `pay_e2e_${nextId++}`;
    payments.set(paymentId, {
      object: 'payment',
      id: paymentId,
      dateCreated: new Date().toISOString().slice(0, 10),
      customer: payload.customer,
      subscription: id,
      value: payload.value,
      netValue: payload.value,
      description: payload.description,
      billingType: payload.billingType,
      status: 'PENDING',
      dueDate: payload.nextDueDate,
      originalDueDate: payload.nextDueDate,
      invoiceUrl: `https://e2e.invalid/invoices/${paymentId}`,
      bankSlipUrl: null,
      deleted: false,
    });
    return send(response, 200, subscription);
  }

  const subscriptionMatch = url.pathname.match(/^\/v3\/subscriptions\/([^/]+)$/);
  if (request.method === 'GET' && subscriptionMatch) {
    const subscription = subscriptions.get(subscriptionMatch[1]);
    return subscription
      ? send(response, 200, subscription)
      : send(response, 404, { errors: [{ code: 'not_found', description: 'Subscription not found.' }] });
  }

  if (request.method === 'GET' && url.pathname === '/v3/payments') {
    const subscriptionId = url.searchParams.get('subscription');
    const externalReference = url.searchParams.get('externalReference');
    const data = [...payments.values()].filter((item) =>
      (!subscriptionId || item.subscription === subscriptionId) &&
      (!externalReference || item.externalReference === externalReference));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    return send(response, 200, {
      object: 'list',
      hasMore: offset + limit < data.length,
      totalCount: data.length,
      limit,
      offset,
      data: data.slice(offset, offset + limit),
    });
  }

  return send(response, 404, { errors: [{ code: 'route_not_stubbed', description: `${request.method} ${url.pathname} is outside the E2E Asaas contract.` }] });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`[e2e-asaas-stub] listening on https://127.0.0.1:${port}\n`);
});

http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true, mode: 'e2e-only' }));
  }
  response.writeHead(404);
  response.end();
}).listen(healthPort, '127.0.0.1');

server.on('error', (error) => {
  process.stderr.write(`[e2e-asaas-stub] ${error.message}\n`);
  process.exitCode = 1;
});
