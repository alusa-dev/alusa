import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/twilio/send/route';
import { NextRequest } from 'next/server';

// Mock do Twilio
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        sid: 'SM123456789abcdef',
        status: 'queued',
        to: 'whatsapp:+5511999999999',
        from: 'whatsapp:+14155238886',
        dateSent: new Date(),
      }),
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
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('deve enviar mensagem com sucesso usando Auth Token', async () => {
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
});
