export type WhatsAppLanguage = {
  code: string;
};

export type WhatsAppTemplateComponent = {
  type: 'body' | 'header' | 'button';
  sub_type?: string;
  index?: string;
  parameters?: Array<{
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
    text?: string;
    image?: { link: string };
    document?: { link: string; filename?: string };
    video?: { link: string };
  }>;
};

export type WhatsAppMessageRequest =
  | {
      kind: 'template';
      to: string;
      templateName: string;
      languageCode: string;
      components?: WhatsAppTemplateComponent[];
    }
  | {
      kind: 'text';
      to: string;
      body: string;
    }
  | {
      kind: 'document';
      to: string;
      link: string;
      filename?: string;
      caption?: string;
    };

export type WhatsAppSendResult = {
  messageId: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
};

export type WhatsAppWebhookMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string; sha256?: string };
};

export type WhatsAppWebhookStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

export type WhatsAppWebhookRecord = {
  phoneNumberId: string;
  messages: WhatsAppWebhookMessage[];
  statuses: WhatsAppWebhookStatus[];
};
