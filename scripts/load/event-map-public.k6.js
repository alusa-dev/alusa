/* global __ENV, __VU */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const REQUIRED_PREVIEW_ACK = 'I_CONFIRM_ISOLATED_NON_PRODUCTION_PREVIEW';
const REQUIRED_SYNTHETIC_ACK = 'I_CONFIRM_SYNTHETIC_EXCLUSIVE_FIXTURE';

function required(name) {
  const value = (__ENV[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseInteger(name, { min, max, fallback } = {}) {
  const raw = (__ENV[name] || (fallback === undefined ? '' : String(fallback))).trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function isIpAddress(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function validateTarget() {
  const baseUrl = required('BASE_URL');
  const allowlistedHost = required('ALLOWED_TEST_HOST').toLowerCase();
  const originMatch = /^https:\/\/([^/?#@]+)\/?$/i.exec(baseUrl);
  if (!originMatch) {
    throw new Error('BASE_URL must be an HTTPS origin without credentials, port, path, query, or fragment.');
  }

  const hostname = originMatch[1].toLowerCase();
  if (hostname.includes(':')) throw new Error('Custom ports and IP-address targets are rejected.');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error('BASE_URL must use a valid fully qualified hostname.');
  }
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || isIpAddress(hostname)
  ) {
    throw new Error('Localhost and IP-address targets are rejected.');
  }
  if (!hostname.includes('.') || hostname !== allowlistedHost) {
    throw new Error('BASE_URL hostname must exactly match ALLOWED_TEST_HOST.');
  }
  const isBranchPreviewAlias = /^alusa-web-git-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/.test(hostname);
  const isProductionBranchAlias = /^alusa-web-git-(?:main|master|prod|production)-/.test(hostname);
  if (!hostname.endsWith('.vercel.app') || !isBranchPreviewAlias) {
    throw new Error('Only Vercel branch-alias Preview URLs in alusa-web-git-<branch>-<team>.vercel.app form are allowed.');
  }
  if (isProductionBranchAlias) {
    throw new Error('Vercel aliases for main, master, prod, or production branches are blocked.');
  }
  if (__ENV.TARGET_ENV !== 'isolated-preview') {
    throw new Error('Set TARGET_ENV=isolated-preview only for a dedicated non-production deployment.');
  }
  if (__ENV.NON_PRODUCTION_ACK !== REQUIRED_PREVIEW_ACK) {
    throw new Error('Explicit non-production preview confirmation is required.');
  }

  return { baseUrl: `https://${hostname}`, hostname };
}

const MODE = required('MODE');
if (MODE !== 'read' && MODE !== 'reserve') {
  throw new Error('MODE must be either read or reserve.');
}

const TARGET = validateTarget();
const PUBLIC_SLUG = required('PUBLIC_SLUG');
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(PUBLIC_SLUG)) {
  throw new Error('PUBLIC_SLUG contains unsupported characters or has an invalid length.');
}

const MAP_URL = `${TARGET.baseUrl}/api/public/event-maps/${encodeURIComponent(PUBLIC_SLUG)}`;
const RESERVE_URL = `${MAP_URL}/reserve`;
const RESERVE_MODE = MODE === 'reserve' ? required('RESERVE_MODE') : '';
const PROFILE = MODE === 'read' ? (__ENV.PROFILE || 'steady').trim() : '';

let reserveVus = 0;
let seatIds = [];
if (MODE === 'read' && PROFILE !== 'steady' && PROFILE !== 'stress') {
  throw new Error('PROFILE must be steady or stress.');
}

if (MODE === 'reserve') {
  if (RESERVE_MODE !== 'unique' && RESERVE_MODE !== 'contention') {
    throw new Error('RESERVE_MODE must be unique or contention.');
  }
  if (__ENV.SYNTHETIC_FIXTURE_ACK !== REQUIRED_SYNTHETIC_ACK) {
    throw new Error('Reservation mode requires confirmation of a synthetic, exclusive fixture.');
  }
  reserveVus = parseInteger('RESERVE_VUS', { min: 1, max: 1000 });
  if (RESERVE_MODE === 'unique') {
    seatIds = required('RESERVATION_SEAT_IDS').split(',').map((seatId) => seatId.trim());
    if (seatIds.some((seatId) => seatId.length < 1 || seatId.length > 120)) {
      throw new Error('Every RESERVATION_SEAT_IDS item must contain an ID of 1 to 120 characters.');
    }
    if (new Set(seatIds).size !== seatIds.length) {
      throw new Error('RESERVATION_SEAT_IDS must contain unique IDs.');
    }
    if (seatIds.length < reserveVus) {
      throw new Error('Unique-seat mode requires at least one exclusive seat ID per VU.');
    }
  } else {
    const contentionSeatId = required('CONTENTION_SEAT_ID');
    if (contentionSeatId.includes(',') || contentionSeatId.length > 120) {
      throw new Error('CONTENTION_SEAT_ID must contain exactly one seat ID.');
    }
    seatIds = [contentionSeatId];
  }
}

const status200 = new Counter('event_map_http_200');
const status409 = new Counter('event_map_http_409');
const status429 = new Counter('event_map_http_429');
const status5xx = new Counter('event_map_http_5xx');
const statusOther = new Counter('event_map_http_other');
const unexpectedResponse = new Counter('event_map_unexpected_response');

const readSteadyStages = [
  { duration: '3m', target: 100 },
  { duration: '5m', target: 100 },
  { duration: '5m', target: 300 },
  { duration: '5m', target: 300 },
  { duration: '5m', target: 600 },
  { duration: '15m', target: 600 },
  { duration: '3m', target: 0 },
];

const readStressStages = [
  { duration: '3m', target: 100 },
  { duration: '5m', target: 100 },
  { duration: '5m', target: 300 },
  { duration: '5m', target: 300 },
  { duration: '5m', target: 600 },
  { duration: '5m', target: 600 },
  { duration: '5m', target: 800 },
  { duration: '5m', target: 800 },
  { duration: '5m', target: 1000 },
  { duration: '10m', target: 1000 },
  { duration: '3m', target: 0 },
];

export const options = {
  discardResponseBodies: true,
  scenarios: MODE === 'read'
    ? {
        public_map_read: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: PROFILE === 'stress' ? readStressStages : readSteadyStages,
          gracefulRampDown: '30s',
          tags: { mode: 'read' },
        },
      }
    : {
        controlled_reservations: {
          exec: 'reserve',
          executor: 'per-vu-iterations',
          vus: reserveVus,
          iterations: 1,
          maxDuration: '10m',
          gracefulStop: '30s',
          tags: { mode: 'reserve' },
        },
      },
  thresholds: {
    [`event_map_unexpected_response{mode:${MODE}}`]: ['count<1'],
    'event_map_http_429': ['count<1'],
    'event_map_http_5xx': ['count<1'],
    [`http_req_duration{operation:${MODE === 'read' ? 'public_map_read' : 'public_map_reserve'}}`]: MODE === 'read'
      ? ['p(95)<2000', 'p(99)<4000']
      : ['p(95)<2000', 'p(99)<5000'],
    ...(MODE === 'reserve' && RESERVE_MODE === 'contention'
      ? { 'event_map_http_200{mode:reserve}': ['count==1'] }
      : {}),
  },
};

function recordStatus(response) {
  const status = response.status;
  const tags = { mode: MODE };
  if (status === 200) status200.add(1, tags);
  else if (status === 409) status409.add(1, tags);
  else if (status === 429) status429.add(1, tags);
  else if (status >= 500 && status <= 599) status5xx.add(1, tags);
  else statusOther.add(1, tags);

  const expected = MODE === 'read'
    ? status === 200
    : RESERVE_MODE === 'contention'
      ? status === 200 || status === 409
      : status === 200;
  unexpectedResponse.add(expected ? 0 : 1, tags);
  check(response, {
    [`${MODE} response is expected for configured fixture`]: () => expected,
  });
}

function previewHeaders() {
  const headers = { Accept: 'application/json' };
  const bypassSecret = (__ENV.VERCEL_PROTECTION_BYPASS || '').trim();
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

export default function () {
  if (MODE !== 'read') return;

  const response = http.get(MAP_URL, {
    headers: previewHeaders(),
    tags: { operation: 'public_map_read' },
    timeout: '30s',
  });
  recordStatus(response);
  sleep(0.75 + Math.random() * 1.5);
}

export function reserve() {
  const seatId = RESERVE_MODE === 'unique' ? seatIds[__VU - 1] : seatIds[0];
  const response = http.post(
    RESERVE_URL,
    JSON.stringify({ seatIds: [seatId] }),
    {
      headers: { ...previewHeaders(), 'Content-Type': 'application/json' },
      tags: { operation: 'public_map_reserve' },
      timeout: '30s',
    },
  );
  recordStatus(response);
}
