import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/twilio/send/route';
import { NextRequest } from 'next/server';

const twilioMessagesCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

// Mock do Twilio
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: twilioMessagesCreateMock,
    },
  })),
}));

describe('POST /api/twilio/send', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      TWILIO_AUTH_TOKEN: 'twilio_auth_token_placeholder',
      TWILIO_FROM_NUMBER: 'whatsapp:+14155238886',
    };
    twilioMessagesCreateMock.mockResolvedValue({
      sid: 'SM123456789abcdef',
      status: 'queued',
      to: 'whatsapp:+5511999999999',
      from: 'whatsapp:+14155238886',
      dateSent: new Date(),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  async function mockSession(user: { id?: string; contaId?: string } | null = { id: 'user-1', contaId: 'conta-1' }) {
    const mod = await import('@/lib/safe-server-session');
    vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
  }

  it('deve enviar mensagem com sucesso usando Auth Token', async () => {
    await mockSession();
    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '11999999999' }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      sid: 'SM123456789abcdef',
      status: 'sent',
    });
  });

  it('deve enviar mensagem com sucesso usando API Key', async () => {
    await mockSession();
    // Configurar API Key em vez de Auth Token
    process.env = {
      ...originalEnv,
      TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      TWILIO_API_KEY_SID: 'SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      TWILIO_API_KEY_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      TWILIO_FROM_NUMBER: 'whatsapp:+14155238886',
    };

    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '11999999999' }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      sid: 'SM123456789abcdef',
      status: 'sent',
    });
  });

  it('deve rejeitar número vazio', async () => {
    await mockSession();
    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '' }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Número de destino é obrigatório');
  });

  it('deve retornar erro se variáveis de ambiente ausentes', async () => {
    await mockSession();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_API_KEY_SID;
    delete process.env.TWILIO_API_KEY_SECRET;

    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '11999999999' }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Configuração Twilio incompleta');
  });

  it('deve aceitar mensagem customizada', async () => {
    await mockSession();
    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({
        numero: '11999999999',
        mensagem: 'Mensagem customizada',
      }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('deve exigir autenticação', async () => {
    await mockSession(null);
    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '11999999999' }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Não autorizado');
  });

  it('não deve vazar detalhes sensíveis em erro do Twilio', async () => {
    await mockSession();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    twilioMessagesCreateMock.mockRejectedValueOnce({
      code: 21211,
      status: 400,
      message: 'Invalid To whatsapp:+5511999999999 using token twilio_auth_token_placeholder',
      moreInfo: 'https://example.test/+5511999999999',
    });

    const req = new NextRequest('http://localhost:3000/api/twilio/send', {
      method: 'POST',
      body: JSON.stringify({ numero: '11999999999' }),
    });

    try {
      const response = await POST(req);
      const data = await response.json();
      const responseBody = JSON.stringify(data);
      const logs = JSON.stringify(errorSpy.mock.calls);

      expect(response.status).toBe(400);
      expect(data).toMatchObject({
        error: 'Erro ao enviar mensagem via Twilio',
        code: 21211,
      });
      expect(responseBody).not.toContain('+5511999999999');
      expect(responseBody).not.toContain('twilio_auth_token_placeholder');
      expect(responseBody).not.toContain('moreInfo');
      expect(logs).not.toContain('+5511999999999');
      expect(logs).not.toContain('twilio_auth_token_placeholder');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
