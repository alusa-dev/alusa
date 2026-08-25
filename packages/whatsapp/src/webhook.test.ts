import { describe, expect, it } from 'vitest';
import { extractWhatsAppWebhookRecords, hashWebhookBody } from './webhook';

describe('WhatsApp webhook parser', () => {
  it('extrai mensagens e statuses preservando o phone_number_id', () => {
    const records = extractWhatsAppWebhookRecords({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '123' },
                messages: [{ id: 'wamid.in', from: '5597981283106', type: 'text', text: { body: 'Oi' } }],
                statuses: [{ id: 'wamid.out', status: 'delivered', recipient_id: '5597981283106' }],
              },
            },
          ],
        },
      ],
    });

    expect(records).toEqual([
      {
        phoneNumberId: '123',
        messages: [{ id: 'wamid.in', from: '5597981283106', type: 'text', text: { body: 'Oi' }, image: undefined, document: undefined }],
        statuses: [{ id: 'wamid.out', status: 'delivered', recipient_id: '5597981283106', timestamp: undefined, errors: undefined }],
      },
    ]);
  });

  it('calcula hash estável para dedupe do corpo bruto', () => {
    expect(hashWebhookBody('payload')).toBe(hashWebhookBody('payload'));
    expect(hashWebhookBody('payload')).not.toBe(hashWebhookBody('other-payload'));
  });
});
