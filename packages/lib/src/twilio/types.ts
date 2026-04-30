/**
 * Twilio Integration - TypeScript Type Definitions
 *
 * Definições de tipos TypeScript para a integração com Twilio.
 * Complementa os schemas Zod com tipos adicionais e interfaces.
 *
 * @module lib/twilio/types
 */

import type {
  SendMessageInput,
  TwilioMessageResponse,
  TwilioCredentials,
  TwilioWebhook,
  TwilioError,
  MessageHistory,
  ListMessagesQuery,
} from './schemas';

// Re-exportar tipos do schema para conveniência
export type {
  SendMessageInput,
  TwilioMessageResponse,
  TwilioCredentials,
  TwilioWebhook,
  TwilioError,
  MessageHistory,
  ListMessagesQuery,
};

/**
 * Opções de configuração do serviço Twilio
 */
export interface TwilioServiceOptions {
  /** Account SID da conta Twilio */
  accountSid: string;

  /** Auth Token (método simples de autenticação) */
  authToken?: string;

  /** API Key SID (método recomendado, mais seguro) */
  apiKeySid?: string;

  /** API Key Secret */
  apiKeySecret?: string;

  /** Número Twilio para envio de mensagens */
  fromNumber: string;

  /** Timeout para requisições (em ms) */
  timeout?: number;

  /** Habilitar logs de debug */
  debug?: boolean;
}

/**
 * Tipos de mensagem suportados
 */
export type MessageType = 'whatsapp' | 'sms';

/**
 * Status possíveis de uma mensagem Twilio
 *
 * @see https://www.twilio.com/docs/sms/api/message-resource#message-status-values
 */
export type MessageStatus =
  | 'accepted' // Mensagem aceita pela API
  | 'queued' // Mensagem enfileirada para envio
  | 'sending' // Mensagem sendo enviada
  | 'sent' // Mensagem enviada ao destinatário
  | 'delivered' // Mensagem entregue (confirmação recebida)
  | 'undelivered' // Não entregue (falha na entrega)
  | 'failed' // Falha no envio
  | 'canceled'; // Mensagem cancelada

/**
 * Direção da mensagem
 */
export type MessageDirection =
  | 'inbound' // Mensagem recebida
  | 'outbound-api' // Enviada via API
  | 'outbound-call' // Enviada durante chamada
  | 'outbound-reply'; // Resposta automática

/**
 * Resultado do envio de mensagem
 */
export interface SendMessageResult {
  /** Sucesso ou falha */
  success: boolean;

  /** Dados da mensagem (se sucesso) */
  data?: TwilioMessageResponse;

  /** Erro (se falha) */
  error?: TwilioError;

  /** Timestamp da operação */
  timestamp: Date;
}

/**
 * Parâmetros para buscar mensagens
 */
export interface ListMessagesParams {
  /** Filtrar por número de destino */
  to?: string;

  /** Filtrar por número de origem */
  from?: string;

  /** Filtrar por data de envio */
  dateSent?: Date | string;

  /** Data de início (range) */
  dateSentAfter?: Date | string;

  /** Data de fim (range) */
  dateSentBefore?: Date | string;

  /** Quantidade de resultados */
  pageSize?: number;

  /** Número da página */
  page?: number;
}

/**
 * Resposta paginada de mensagens
 */
export interface MessageListResponse {
  /** Lista de mensagens */
  messages: MessageHistory[];

  /** Informações de paginação */
  pagination: {
    /** Página atual */
    page: number;

    /** Tamanho da página */
    pageSize: number;

    /** Total de mensagens */
    total?: number;

    /** URL para próxima página */
    nextPageUrl?: string;

    /** URL para página anterior */
    previousPageUrl?: string;
  };
}

/**
 * Configuração de webhook para status de mensagens
 */
export interface WebhookConfig {
  /** URL para receber notificações */
  url: string;

  /** Método HTTP */
  method?: 'GET' | 'POST';

  /** Tipos de status para notificar */
  statusCallbackEvents?: MessageStatus[];
}

/**
 * Opções avançadas para envio de mensagem
 */
export interface AdvancedSendOptions extends SendMessageInput {
  /** URL para callback de status */
  statusCallback?: string;

  /** Messaging Service SID (alternativa ao fromNumber) */
  messagingServiceSid?: string;

  /** Tentar enviar como MMS se necessário */
  sendAsMms?: boolean;

  /** Período de validade da mensagem (em segundos) */
  validityPeriod?: number;

  /** URL de mídia para anexar (MMS) */
  mediaUrl?: string[];

  /** Agendar envio para data/hora futura */
  scheduledFor?: Date | string;
}

/**
 * Estatísticas de uso Twilio
 */
export interface TwilioUsageStats {
  /** Total de mensagens enviadas */
  totalSent: number;

  /** Mensagens entregues */
  delivered: number;

  /** Mensagens não entregues */
  undelivered: number;

  /** Mensagens com falha */
  failed: number;

  /** Custo total (USD) */
  totalCost: number;

  /** Período das estatísticas */
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * Códigos de erro comuns da API Twilio
 *
 * @see https://www.twilio.com/docs/api/errors
 */
export enum TwilioErrorCode {
  // Erros de autenticação (20xxx)
  AUTHENTICATION_FAILED = 20003,
  INVALID_AUTH_TOKEN = 20004,
  ACCOUNT_NOT_ACTIVE = 20005,

  // Erros de número (21xxx)
  INVALID_PHONE_NUMBER = 21211,
  PHONE_NUMBER_NOT_VERIFIED = 21408,
  PERMISSION_TO_SEND_SMS = 21606,

  // Erros de mensagem (30xxx)
  MESSAGE_DELIVERY_FAILED = 30003,
  MESSAGE_BLOCKED = 30004,
  MESSAGE_QUEUE_OVERFLOW = 30005,
  MESSAGE_PRICE_EXCEEDS_MAX = 30006,
  MESSAGE_CANNOT_ROUTE = 30007,

  // Erros de WhatsApp (63xxx)
  WHATSAPP_NUMBER_NOT_APPROVED = 63016,
  WHATSAPP_RATE_LIMIT = 63017,
}

/**
 * Interface para cliente Twilio customizado
 *
 * Permite injeção de dependência para testes
 */
export interface ITwilioClient {
  messages: {
    create: (_options: {
      from: string;
      to: string;
      body: string;
      mediaUrl?: string[];
      statusCallback?: string;
    }) => Promise<TwilioMessageResponse>;

    list: (_options?: ListMessagesParams) => Promise<MessageHistory[]>;

    get: (_sid: string) => Promise<TwilioMessageResponse>;
  };
}

/**
 * Event emitter para notificações Twilio
 */
export interface TwilioEvents {
  'message:sent': (_message: TwilioMessageResponse) => void;
  'message:delivered': (_webhook: TwilioWebhook) => void;
  'message:failed': (_webhook: TwilioWebhook) => void;
  error: (_error: TwilioError) => void;
}

/**
 * Formato de número de telefone
 */
export interface PhoneNumber {
  /** Código do país */
  countryCode: string;

  /** Código de área (DDD) */
  areaCode: string;

  /** Número local */
  localNumber: string;

  /** Formato completo E.164 */
  e164: string;

  /** Formato nacional */
  national: string;
}

/**
 * Resultado da formatação de número
 */
export interface FormatPhoneNumberResult {
  /** Número formatado para Twilio */
  formatted: string;

  /** Tipo de formatação aplicada */
  type: MessageType;

  /** Número original */
  original: string;

  /** Dados estruturados do número */
  parsed?: PhoneNumber;
}
