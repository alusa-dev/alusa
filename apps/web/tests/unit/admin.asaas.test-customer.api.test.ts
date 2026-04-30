/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    financeProfile: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  listCustomers: vi.fn(),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { loadAsaasCredentials } from '@alusa/database';
import { getCustomer, listCustomers } from '@alusa/asaas';
import { GET } from '@/app/api/admin/asaas/test-customer/route';

function makeRequest(url: string) {
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/admin/asaas/test-customer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', role: 'ADMIN', contaId: 'conta-1' },
    } as never);
  });

  it('bloqueia admin tentando acessar conta de outro tenant', async () => {
    const response = await GET(
      makeRequest('http://localhost/api/admin/asaas/test-customer?contaId=conta-2'),
    );

    expect(response.status).toBe(403);
    expect(prisma.financeProfile.findUnique).not.toHaveBeenCalled();
    expect(loadAsaasCredentials).not.toHaveBeenCalled();
  });

  it('usa sempre a conta da sessão para admin humano', async () => {
    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue({
      asaasAccountId: 'acc_1',
      asaasCredential: { apiKeyEncrypted: 'encrypted' },
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'asaas-key' } as never);
    vi.mocked(listCustomers).mockResolvedValue({
      data: [{ id: 'cus_1', deleted: false }],
    } as never);
    vi.mocked(getCustomer).mockResolvedValue({ id: 'cus_1' } as never);

    const response = await GET(
      makeRequest('http://localhost/api/admin/asaas/test-customer?contaId=conta-1'),
    );

    expect(response.status).toBe(200);
    expect(prisma.financeProfile.findUnique).toHaveBeenCalledWith({
      where: { contaId: 'conta-1' },
      select: { asaasAccountId: true, asaasCredential: { select: { apiKeyEncrypted: true } } },
    });
    expect(loadAsaasCredentials).toHaveBeenCalledWith('conta-1');
  });
});