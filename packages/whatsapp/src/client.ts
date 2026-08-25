import { WhatsAppCloudApiError } from './errors';
import { normalizeWhatsAppPhone } from './phone';
import type { WhatsAppMessageRequest, WhatsAppSendResult } from './types';

type WhatsAppCloudClientOptions = {
  accessToken: string;
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
};

type MetaApiErrorBody = {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
    error_data?: unknown;
  };
};

export class WhatsAppCloudClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WhatsAppCloudClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendMessage(phoneNumberId: string, request: WhatsAppMessageRequest): Promise<WhatsAppSendResult> {
    const response = await this.fetchImpl(
      `https://graph.facebook.com/${this.options.graphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildMetaMessagePayload(request)),
      },
    );

    const body = (await response.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; contacts?: WhatsAppSendResult['contacts'] }
      | MetaApiErrorBody
      | null;

    if (!response.ok) {
      const error = (body as MetaApiErrorBody | null)?.error;
      throw new WhatsAppCloudApiError({
        status: response.status,
        code: error?.code ? String(error.code) : null,
        message: error?.message ?? 'A API do WhatsApp recusou a mensagem.',
        details: error?.error_data,
      });
    }

    const messageId = (body as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id;
    if (!messageId) {
      throw new WhatsAppCloudApiError({
        status: 502,
        code: 'INVALID_META_RESPONSE',
        message: 'A API do WhatsApp não retornou o identificador da mensagem.',
      });
    }

    return {
      messageId,
      contacts: (body as { contacts?: WhatsAppSendResult['contacts'] } | null)?.contacts,
    };
  }
}

function buildMetaMessagePayload(request: WhatsAppMessageRequest) {
  const to = normalizeWhatsAppPhone(request.to);

  if (request.kind === 'template') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: request.templateName,
        language: { code: request.languageCode },
        ...(request.components?.length ? { components: request.components } : {}),
      },
    };
  }

  if (request.kind === 'document') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        link: request.link,
        ...(request.filename ? { filename: request.filename } : {}),
        ...(request.caption ? { caption: request.caption } : {}),
      },
    };
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: request.body },
  };
}

export { buildMetaMessagePayload };
