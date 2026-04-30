/**
 * Twilio Integration - Zod Validation Schemas
 *
 * Schemas de validação para todas as operações da API Twilio.
 * Define contratos de entrada/saída e garante type-safety.
 *
 * @module lib/twilio/schemas
 */

import { z } from 'zod';

/**
 * Schema para envio de mensagens WhatsApp/SMS
 *
 * Valida:
 * - Número de telefone (formato brasileiro ou internacional)
 * - Mensagem (opcional, default será usado se não fornecida)
 * - Tipo de mensagem (whatsapp ou sms)
 */
export const sendMessageSchema = z.object({
  numero: z
    .string()
    .min(10, 'Número deve ter no mínimo 10 dígitos')
    .max(15, 'Número deve ter no máximo 15 dígitos')
    .regex(/^[\d\s\-()+ ]+$/, 'Número contém caracteres inválidos')
    .describe('Número de telefone do destinatário (com ou sem formatação)'),

  mensagem: z
    .string()
    .min(1, 'Mensagem não pode estar vazia')
    .max(1600, 'Mensagem excede o limite de 1600 caracteres')
    .optional()
    .describe('Conteúdo da mensagem a ser enviada'),

  tipo: z.enum(['whatsapp', 'sms']).default('whatsapp').describe('Tipo de mensagem a enviar'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * Schema para resposta de envio de mensagem
 *
 * Retorna informações sobre a mensagem enviada via Twilio
 */
export const twilioMessageResponseSchema = z.object({
  sid: z.string().describe('Identificador único da mensagem no Twilio'),

  status: z
    .enum([
      'accepted',
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'canceled',
    ])
    .describe('Status atual da mensagem'),

  to: z.string().describe('Número de destino formatado'),

  from: z.string().describe('Número de origem (número Twilio)'),

  body: z.string().optional().describe('Conteúdo da mensagem enviada'),

  dateSent: z.union([z.date(), z.string(), z.null()]).optional().describe('Data/hora de envio'),

  dateCreated: z.union([z.date(), z.string()]).optional().describe('Data/hora de criação'),

  errorCode: z.number().nullable().optional().describe('Código de erro (se houver)'),

  errorMessage: z.string().nullable().optional().describe('Mensagem de erro (se houver)'),
});

export type TwilioMessageResponse = z.infer<typeof twilioMessageResponseSchema>;

/**
 * Schema para configuração de credenciais Twilio
 *
 * Suporta dois métodos de autenticação:
 * 1. Auth Token (simples, menos seguro)
 * 2. API Key + API Secret (recomendado, mais seguro)
 */
export const twilioCredentialsSchema = z.object({
  accountSid: z
    .string()
    .startsWith('AC', 'Account SID deve começar com "AC"')
    .length(34, 'Account SID deve ter 34 caracteres')
    .describe('Identificador único da conta Twilio'),

  authToken: z
    .string()
    .length(32, 'Auth Token deve ter 32 caracteres')
    .optional()
    .describe('Token de autenticação principal (Auth Token)'),

  apiKeySid: z
    .string()
    .startsWith('SK', 'API Key SID deve começar com "SK"')
    .length(34, 'API Key SID deve ter 34 caracteres')
    .optional()
    .describe('SID da API Key (método mais seguro)'),

  apiKeySecret: z
    .string()
    .length(32, 'API Key Secret deve ter 32 caracteres')
    .optional()
    .describe('Secret da API Key'),

  fromNumber: z
    .string()
    .regex(/^(whatsapp:)?\+\d{10,15}$/, 'Número deve estar no formato +[código país][número]')
    .describe('Número Twilio para envio de mensagens'),
});

export type TwilioCredentials = z.infer<typeof twilioCredentialsSchema>;

/**
 * Schema para validação de variáveis de ambiente Twilio
 */
export const twilioEnvSchema = z
  .object({
    TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID é obrigatório'),

    TWILIO_AUTH_TOKEN: z.string().optional(),

    TWILIO_API_KEY_SID: z.string().optional(),

    TWILIO_API_KEY_SECRET: z.string().optional(),

    TWILIO_FROM_NUMBER: z.string().min(1, 'TWILIO_FROM_NUMBER é obrigatório'),
  })
  .refine(
    (data) => data.TWILIO_AUTH_TOKEN || (data.TWILIO_API_KEY_SID && data.TWILIO_API_KEY_SECRET),
    {
      message: 'Forneça TWILIO_AUTH_TOKEN OU (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)',
      path: ['TWILIO_AUTH_TOKEN'],
    },
  );

export type TwilioEnv = z.infer<typeof twilioEnvSchema>;

/**
 * Schema para webhook de status de mensagem
 *
 * Recebe notificações do Twilio sobre mudanças no status das mensagens
 */
export const twilioWebhookSchema = z.object({
  MessageSid: z.string().describe('SID da mensagem'),

  MessageStatus: z
    .enum([
      'accepted',
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'canceled',
    ])
    .describe('Novo status da mensagem'),

  To: z.string().describe('Número de destino'),

  From: z.string().describe('Número de origem'),

  ErrorCode: z.string().optional().describe('Código de erro (se houver)'),

  ErrorMessage: z.string().optional().describe('Mensagem de erro (se houver)'),

  AccountSid: z.string().describe('Account SID'),

  MessagingServiceSid: z.string().optional().describe('Messaging Service SID (se usado)'),
});

export type TwilioWebhook = z.infer<typeof twilioWebhookSchema>;

/**
 * Schema para resposta de erro da API
 */
export const twilioErrorSchema = z.object({
  code: z.number().describe('Código de erro Twilio'),

  message: z.string().describe('Mensagem de erro'),

  status: z.number().optional().describe('Status HTTP'),

  moreInfo: z.string().optional().describe('URL com mais informações'),
});

export type TwilioError = z.infer<typeof twilioErrorSchema>;

/**
 * Schema para histórico de mensagens
 *
 * Usado para listar mensagens enviadas/recebidas
 */
export const messageHistorySchema = z.object({
  sid: z.string(),
  to: z.string(),
  from: z.string(),
  body: z.string().optional(),
  status: z.string(),
  dateSent: z.union([z.date(), z.string(), z.null()]).optional(),
  direction: z.enum(['inbound', 'outbound-api', 'outbound-call', 'outbound-reply']),
  price: z.string().nullable().optional(),
  priceUnit: z.string().nullable().optional(),
});

export type MessageHistory = z.infer<typeof messageHistorySchema>;

/**
 * Schema para busca de mensagens (query params)
 */
export const listMessagesQuerySchema = z.object({
  to: z.string().optional().describe('Filtrar por número de destino'),
  from: z.string().optional().describe('Filtrar por número de origem'),
  dateSent: z.string().optional().describe('Filtrar por data (YYYY-MM-DD)'),
  pageSize: z.number().min(1).max(1000).default(50).describe('Quantidade de resultados por página'),
  page: z.number().min(0).default(0).describe('Número da página'),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
