/**
 * Twilio Integration - Service Layer
 *
 * Serviço principal para integração com Twilio (WhatsApp e SMS).
 * Centraliza toda a lógica de comunicação com a API Twilio.
 *
 * @module lib/twilio/service
 */

import Twilio from 'twilio';
import type { Twilio as TwilioClient } from 'twilio';
import {
  sendMessageSchema,
  twilioMessageResponseSchema,
  type SendMessageInput,
  type TwilioMessageResponse,
} from './schemas';
import type {
  TwilioServiceOptions,
  SendMessageResult,
  ListMessagesParams,
  MessageHistory,
} from './types';
import { formatarNumeroTelefone, sanitizeMessage } from './utils';

/**
 * Classe de serviço Twilio
 *
 * Encapsula todas as operações relacionadas ao Twilio:
 * - Envio de mensagens WhatsApp/SMS
 * - Consulta de histórico
 * - Gestão de credenciais
 */
export class TwilioService {
  private client: TwilioClient;
  private readonly fromNumber: string;
  private readonly debug: boolean;

  /**
   * Cria uma nova instância do serviço Twilio
   *
   * @param options - Configurações do serviço
   *
   * @example
   * ```ts
   * const service = new TwilioService({
   *   accountSid: 'ACxxx',
   *   authToken: 'xxx',
   *   fromNumber: 'whatsapp:+14155238886'
   * });
   * ```
   */
  constructor(options: TwilioServiceOptions) {
    const { accountSid, authToken, apiKeySid, apiKeySecret, fromNumber, debug = false } = options;

    // Validar que temos credenciais suficientes
    if (!authToken && (!apiKeySid || !apiKeySecret)) {
      throw new Error('Credenciais inválidas: forneça authToken OU (apiKeySid + apiKeySecret)');
    }

    // Inicializar cliente Twilio
    if (apiKeySid && apiKeySecret) {
      // Método recomendado: API Key (mais seguro)
      this.client = Twilio(apiKeySid, apiKeySecret, { accountSid });
      if (debug) {
        console.log('[Twilio] Cliente inicializado com API Key');
      }
    } else if (authToken) {
      // Método simples: Auth Token
      this.client = Twilio(accountSid, authToken);
      if (debug) {
        console.log('[Twilio] Cliente inicializado com Auth Token');
      }
    } else {
      throw new Error('Credenciais Twilio inválidas');
    }

    this.fromNumber = fromNumber;
    this.debug = debug;
  }

  /**
   * Envia mensagem via WhatsApp ou SMS
   *
   * @param input - Dados da mensagem
   * @returns Resultado do envio
   *
   * @example
   * ```ts
   * const result = await service.sendMessage({
   *   numero: '11987654321',
   *   mensagem: 'Olá do Alusa!',
   *   tipo: 'whatsapp'
   * });
   *
   * if (result.success) {
   *   console.log('Mensagem enviada:', result.data?.sid);
   * }
   * ```
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const timestamp = new Date();

    try {
      // 1. Validar entrada
      const validation = sendMessageSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          error: {
            code: 400,
            message: 'Dados de entrada inválidos',
            status: 400,
          },
          timestamp,
        };
      }

      const { numero, mensagem, tipo = 'whatsapp' } = validation.data;

      if (this.debug) {
        console.log('[Twilio] Enviando mensagem:', {
          numero,
          tipo,
          mensagemLength: mensagem?.length,
        });
      }

      // 2. Formatar número
      const numeroFormatado = formatarNumeroTelefone(numero, tipo);

      // 3. Preparar mensagem
      const messageBody = mensagem
        ? sanitizeMessage(mensagem)
        : 'Olá do Alusa 👋 (mensagem de teste)';

      // 4. Enviar via Twilio
      const twilioMessage = await this.client.messages.create({
        from: this.fromNumber,
        to: numeroFormatado,
        body: messageBody,
      });

      if (this.debug) {
        console.log('[Twilio] ✅ Mensagem enviada:', {
          sid: twilioMessage.sid,
          status: twilioMessage.status,
          to: twilioMessage.to,
        });
      }

      // 5. Validar e retornar resposta
      const response = twilioMessageResponseSchema.parse({
        sid: twilioMessage.sid,
        status: twilioMessage.status,
        to: twilioMessage.to,
        from: twilioMessage.from,
        body: twilioMessage.body,
        dateSent: twilioMessage.dateSent,
        dateCreated: twilioMessage.dateCreated,
        errorCode: twilioMessage.errorCode,
        errorMessage: twilioMessage.errorMessage,
      });

      return {
        success: true,
        data: response,
        timestamp,
      };
    } catch (error) {
      if (this.debug) {
        console.error('[Twilio] ❌ Erro ao enviar mensagem:', error);
      }

      // Erro do Twilio
      if (error && typeof error === 'object' && 'code' in error) {
        const twilioError = error as {
          code: number;
          message: string;
          status?: number;
          moreInfo?: string;
        };

        return {
          success: false,
          error: {
            code: twilioError.code,
            message: twilioError.message,
            status: twilioError.status,
            moreInfo: twilioError.moreInfo,
          },
          timestamp,
        };
      }

      // Erro genérico
      return {
        success: false,
        error: {
          code: 500,
          message: error instanceof Error ? error.message : 'Erro desconhecido',
          status: 500,
        },
        timestamp,
      };
    }
  }

  /**
   * Lista mensagens enviadas/recebidas
   *
   * @param params - Filtros de busca
   * @returns Lista de mensagens
   *
   * @example
   * ```ts
   * const messages = await service.listMessages({
   *   to: 'whatsapp:+5511987654321',
   *   pageSize: 20
   * });
   * ```
   */
  async listMessages(params?: ListMessagesParams): Promise<MessageHistory[]> {
    try {
      const options: Record<string, unknown> = {};

      if (params?.to) options.to = params.to;
      if (params?.from) options.from = params.from;
      if (params?.dateSent) {
        options.dateSent = params.dateSent;
      }
      if (params?.dateSentAfter) {
        options.dateSentAfter = params.dateSentAfter;
      }
      if (params?.dateSentBefore) {
        options.dateSentBefore = params.dateSentBefore;
      }
      if (params?.pageSize) options.limit = params.pageSize;

      const messages = await this.client.messages.list(options);

      return messages.map((msg) => ({
        sid: msg.sid,
        to: msg.to,
        from: msg.from,
        body: msg.body || undefined,
        status: msg.status,
        dateSent: msg.dateSent,
        direction: msg.direction,
        price: msg.price,
        priceUnit: msg.priceUnit,
      }));
    } catch (error) {
      if (this.debug) {
        console.error('[Twilio] Erro ao listar mensagens:', error);
      }
      throw error;
    }
  }

  /**
   * Busca detalhes de uma mensagem específica
   *
   * @param sid - Message SID
   * @returns Dados da mensagem
   *
   * @example
   * ```ts
   * const message = await service.getMessage('SM1234...');
   * ```
   */
  async getMessage(sid: string): Promise<TwilioMessageResponse> {
    try {
      const message = await this.client.messages(sid).fetch();

      return twilioMessageResponseSchema.parse({
        sid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        body: message.body,
        dateSent: message.dateSent,
        dateCreated: message.dateCreated,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
      });
    } catch (error) {
      if (this.debug) {
        console.error('[Twilio] Erro ao buscar mensagem:', error);
      }
      throw error;
    }
  }

  /**
   * Verifica o saldo da conta Twilio
   *
   * @returns Saldo em USD
   *
   * @example
   * ```ts
   * const balance = await service.getBalance();
   * console.log('Saldo:', balance); // '15.75'
   * ```
   */
  async getBalance(): Promise<string> {
    try {
      const account = await this.client.api.v2010.accounts(this.client.accountSid).fetch();
      const balance = account.balance;
      return typeof balance === 'string' ? balance : '0.00';
    } catch (error) {
      if (this.debug) {
        console.error('[Twilio] Erro ao buscar saldo:', error);
      }
      throw error;
    }
  }

  /**
   * Testa a conexão com a API Twilio
   *
   * @returns true se conexão ok
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.api.accounts(this.client.accountSid).fetch();
      return true;
    } catch (error) {
      if (this.debug) {
        console.error('[Twilio] Erro ao testar conexão:', error);
      }
      return false;
    }
  }
}

/**
 * Cria instância do serviço Twilio a partir de variáveis de ambiente
 *
 * @returns Instância configurada do TwilioService
 * @throws Error se variáveis de ambiente não estiverem configuradas
 *
 * @example
 * ```ts
 * const service = createTwilioService();
 * await service.sendMessage({ numero: '11987654321', mensagem: 'Olá!' });
 * ```
 */
export function createTwilioService(): TwilioService {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid) {
    throw new Error('TWILIO_ACCOUNT_SID não está configurado');
  }

  if (!fromNumber) {
    throw new Error('TWILIO_FROM_NUMBER não está configurado');
  }

  if (!authToken && (!apiKeySid || !apiKeySecret)) {
    throw new Error('Configure TWILIO_AUTH_TOKEN OU (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)');
  }

  return new TwilioService({
    accountSid,
    authToken,
    apiKeySid,
    apiKeySecret,
    fromNumber,
    debug: process.env.NODE_ENV !== 'production',
  });
}

/**
 * Instância singleton do serviço Twilio (lazy-loaded)
 */
let twilioServiceInstance: TwilioService | null = null;

/**
 * Obtém instância singleton do serviço Twilio
 *
 * Cria a instância apenas quando necessário e reutiliza em chamadas subsequentes
 *
 * @returns Instância do TwilioService
 *
 * @example
 * ```ts
 * const service = getTwilioService();
 * await service.sendMessage({ numero: '11987654321', mensagem: 'Olá!' });
 * ```
 */
export function getTwilioService(): TwilioService {
  if (!twilioServiceInstance) {
    twilioServiceInstance = createTwilioService();
  }
  return twilioServiceInstance;
}

/**
 * Reseta a instância singleton (útil para testes)
 */
export function resetTwilioService(): void {
  twilioServiceInstance = null;
}

// Exportar classe e funções
export default TwilioService;
