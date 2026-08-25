import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildMetaMessagePayload, WhatsAppCloudClient } from './client';
import { verifyMetaWebhookSignature } from './signature';

describe('WhatsAppCloudClient', () => {
  it('monta mensagem de template no contrato da Cloud API', () => {
    expect(
      buildMetaMessagePayload({
        kind: 'template',
        to: '+55 (97) 98128-3106',
        templateName: 'hello_world',
        languageCode: 'en_US',
      }),
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5597981283106',
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
  });

  it('retorna o id da mensagem sem expor o token em erro ou resultado', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 }),
    );
    const client = new WhatsAppCloudClient({ accessToken: 'secret-token', graphApiVersion: 'v25.0', fetchImpl });

    await expect(
      client.sendMessage('phone-1', { kind: 'text', to: '5597981283106', body: 'Teste' }),
    ).resolves.toEqual({ messageId: 'wamid.test', contacts: undefined });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
        body: expect.not.stringContaining('secret-token'),
      }),
    );
  });
});

describe('verifyMetaWebhookSignature', () => {
  it('valida a assinatura HMAC SHA-256 do corpo bruto', () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(rawBody).digest('hex')}`;

    expect(
      verifyMetaWebhookSignature({ rawBody, signatureHeader: signature, appSecret: 'app-secret' }),
    ).toBe(true);
    expect(
      verifyMetaWebhookSignature({
        rawBody,
        signatureHeader: 'sha256=invalid',
        appSecret: 'app-secret',
      }),
    ).toBe(false);
  });
});
