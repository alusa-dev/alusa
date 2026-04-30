/**
 * Twilio Integration - Utility Functions
 *
 * Funções auxiliares para formatação de números, validações
 * e operações comuns da integração Twilio.
 *
 * @module lib/twilio/utils
 */

import type { MessageType, PhoneNumber, FormatPhoneNumberResult } from './types';

/**
 * Remove todos os caracteres não-numéricos de uma string
 *
 * @param input - String a ser limpa
 * @returns String apenas com dígitos
 *
 * @example
 * ```ts
 * removeNonDigits('(11) 98765-4321') // '11987654321'
 * removeNonDigits('+55 11 9 8765-4321') // '5511987654321'
 * ```
 */
export function removeNonDigits(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Formata número de telefone para o padrão WhatsApp do Twilio
 *
 * Formato esperado: `whatsapp:+[código país][DDD][número]`
 *
 * Suporta:
 * - Números brasileiros com/sem código do país
 * - Números internacionais
 * - Números já formatados
 *
 * @param numero - Número de telefone em qualquer formato
 * @returns Número formatado para WhatsApp
 * @throws Error se número for inválido
 *
 * @example
 * ```ts
 * formatarNumeroWhatsApp('11987654321') // 'whatsapp:+5511987654321'
 * formatarNumeroWhatsApp('5511987654321') // 'whatsapp:+5511987654321'
 * formatarNumeroWhatsApp('+55 11 98765-4321') // 'whatsapp:+5511987654321'
 * ```
 */
export function formatarNumeroWhatsApp(numero: string): string {
  return formatarNumeroTelefone(numero, 'whatsapp');
}

/**
 * Formata número de telefone para o padrão SMS do Twilio
 *
 * Formato esperado: `+[código país][DDD][número]`
 *
 * @param numero - Número de telefone em qualquer formato
 * @returns Número formatado para SMS
 * @throws Error se número for inválido
 *
 * @example
 * ```ts
 * formatarNumeroSMS('11987654321') // '+5511987654321'
 * formatarNumeroSMS('5511987654321') // '+5511987654321'
 * ```
 */
export function formatarNumeroSMS(numero: string): string {
  return formatarNumeroTelefone(numero, 'sms');
}

/**
 * Formata número de telefone para o padrão Twilio (WhatsApp ou SMS)
 *
 * @param numero - Número de telefone em qualquer formato
 * @param tipo - Tipo de mensagem ('whatsapp' ou 'sms')
 * @returns Número formatado
 * @throws Error se número for inválido
 */
export function formatarNumeroTelefone(numero: string, tipo: MessageType = 'whatsapp'): string {
  // 1. Remover caracteres não-numéricos
  let numeroLimpo = removeNonDigits(numero);

  // 2. Validar tamanho mínimo
  if (numeroLimpo.length < 10) {
    throw new Error(`Número muito curto: ${numero} (mínimo 10 dígitos)`);
  }

  // 3. Adicionar código do país se não tiver
  if (!numeroLimpo.startsWith('55') && numeroLimpo.length === 11) {
    // Número brasileiro sem código do país
    numeroLimpo = `55${numeroLimpo}`;
  } else if (!numeroLimpo.startsWith('55') && numeroLimpo.length === 10) {
    // Número brasileiro antigo (sem 9º dígito) sem código do país
    // Adicionar 9 ao início do número local (padrão celular brasileiro)
    const ddd = numeroLimpo.substring(0, 2);
    const localNumber = numeroLimpo.substring(2);
    numeroLimpo = `55${ddd}9${localNumber}`;
  }

  // 4. Validar tamanho final
  if (numeroLimpo.length < 12 || numeroLimpo.length > 15) {
    throw new Error(
      `Número com formato inválido: ${numero} (esperado 12-15 dígitos, recebido ${numeroLimpo.length})`,
    );
  }

  // 5. Formatar conforme o tipo
  if (tipo === 'whatsapp') {
    return `whatsapp:+${numeroLimpo}`;
  }

  return `+${numeroLimpo}`;
}

/**
 * Parse de número de telefone brasileiro
 *
 * Extrai código do país, DDD e número local de um número brasileiro
 *
 * @param numero - Número de telefone
 * @returns Objeto com partes do número ou null se inválido
 *
 * @example
 * ```ts
 * parsePhoneNumber('5511987654321')
 * // { countryCode: '55', areaCode: '11', localNumber: '987654321', e164: '+5511987654321', national: '(11) 98765-4321' }
 * ```
 */
export function parsePhoneNumber(numero: string): PhoneNumber | null {
  const numeroLimpo = removeNonDigits(numero);

  // Validar número brasileiro
  if (!numeroLimpo.startsWith('55')) {
    return null;
  }

  if (numeroLimpo.length < 12 || numeroLimpo.length > 13) {
    return null;
  }

  const countryCode = numeroLimpo.substring(0, 2); // '55'
  const areaCode = numeroLimpo.substring(2, 4); // '11'
  const localNumber = numeroLimpo.substring(4); // '987654321'

  // Formatar número nacional
  let national: string;
  if (localNumber.length === 9) {
    // Celular: (11) 98765-4321
    national = `(${areaCode}) ${localNumber.substring(0, 5)}-${localNumber.substring(5)}`;
  } else if (localNumber.length === 8) {
    // Fixo: (11) 3456-7890
    national = `(${areaCode}) ${localNumber.substring(0, 4)}-${localNumber.substring(4)}`;
  } else {
    national = `(${areaCode}) ${localNumber}`;
  }

  return {
    countryCode,
    areaCode,
    localNumber,
    e164: `+${numeroLimpo}`,
    national,
  };
}

/**
 * Formata número de telefone com resultado detalhado
 *
 * @param numero - Número de telefone
 * @param tipo - Tipo de mensagem
 * @returns Resultado com número formatado e informações adicionais
 */
export function formatPhoneNumberDetailed(
  numero: string,
  tipo: MessageType = 'whatsapp',
): FormatPhoneNumberResult {
  const formatted = formatarNumeroTelefone(numero, tipo);
  const parsed = parsePhoneNumber(numero);

  return {
    formatted,
    type: tipo,
    original: numero,
    parsed: parsed || undefined,
  };
}

/**
 * Valida se um número está no formato correto para Twilio
 *
 * @param numero - Número formatado
 * @returns true se válido
 */
export function isValidTwilioNumber(numero: string): boolean {
  // WhatsApp: whatsapp:+[10-15 dígitos]
  const whatsappPattern = /^whatsapp:\+\d{10,15}$/;

  // SMS: +[10-15 dígitos]
  const smsPattern = /^\+\d{10,15}$/;

  return whatsappPattern.test(numero) || smsPattern.test(numero);
}

/**
 * Extrai apenas o número do formato Twilio
 *
 * Remove prefixos como 'whatsapp:' e '+'
 *
 * @param numeroTwilio - Número no formato Twilio
 * @returns Número limpo
 *
 * @example
 * ```ts
 * extractPhoneNumber('whatsapp:+5511987654321') // '5511987654321'
 * extractPhoneNumber('+5511987654321') // '5511987654321'
 * ```
 */
export function extractPhoneNumber(numeroTwilio: string): string {
  return numeroTwilio.replace(/^(whatsapp:)?\+/, '');
}

/**
 * Valida se uma mensagem está dentro dos limites do Twilio
 *
 * - SMS: até 1600 caracteres (concatenado)
 * - WhatsApp: até 1600 caracteres
 *
 * @param mensagem - Texto da mensagem
 * @param tipo - Tipo de mensagem
 * @returns true se válida
 */
export function isValidMessageLength(mensagem: string, tipo: MessageType = 'whatsapp'): boolean {
  const maxLength = tipo === 'sms' ? 1600 : 1600;
  return mensagem.length > 0 && mensagem.length <= maxLength;
}

/**
 * Calcula quantos segmentos SMS serão necessários
 *
 * SMS padrão: 160 caracteres/segmento
 * SMS com Unicode: 70 caracteres/segmento
 *
 * @param mensagem - Texto da mensagem
 * @returns Número de segmentos
 */
export function calculateSmsSegments(mensagem: string): number {
  // eslint-disable-next-line no-control-regex
  const hasUnicode = /[^\x00-\x7F]/.test(mensagem);
  const maxPerSegment = hasUnicode ? 70 : 160;

  return Math.ceil(mensagem.length / maxPerSegment);
}

/**
 * Formata um SID do Twilio para exibição
 *
 * @param sid - Message SID
 * @returns SID formatado
 *
 * @example
 * ```ts
 * formatSid('SM1234567890abcdef1234567890abcd') // 'SM12...abcd'
 * ```
 */
export function formatSid(sid: string): string {
  if (sid.length <= 8) return sid;
  return `${sid.substring(0, 4)}...${sid.substring(sid.length - 4)}`;
}

/**
 * Converte timestamp do Twilio para Date
 *
 * @param timestamp - Timestamp em formato ISO ou RFC2822
 * @returns Objeto Date ou null se inválido
 */
export function parseTwilioDate(timestamp: string | Date | null): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;

  try {
    const date = new Date(timestamp);
    // Validar se é uma data válida
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

/**
 * Formata valor monetário (preço de mensagens)
 *
 * @param value - Valor em string (ex: '-0.0075')
 * @param currency - Moeda (default: 'USD')
 * @returns Valor formatado
 *
 * @example
 * ```ts
 * formatPrice('-0.0075', 'USD') // '-$0.01'
 * ```
 */
export function formatPrice(value: string | null, currency: string = 'USD'): string {
  if (!value) return '$0.00';

  const numValue = Math.abs(parseFloat(value));
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(numValue);

  return value.startsWith('-') ? `-${formatted}` : formatted;
}

/**
 * Sanitiza mensagem para evitar problemas de encoding
 *
 * Remove caracteres de controle e normaliza espaços
 *
 * @param mensagem - Mensagem original
 * @returns Mensagem sanitizada
 */
export function sanitizeMessage(mensagem: string): string {
  return (
    mensagem
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
      .replace(/\s+/g, ' ') // Normaliza espaços múltiplos
      .trim()
  );
}

/**
 * Gera ID único para tracking de mensagens
 *
 * @returns ID único (timestamp + random)
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `msg_${timestamp}_${random}`;
}

/**
 * Valida credenciais Twilio
 *
 * @param accountSid - Account SID
 * @param authToken - Auth Token ou API Key Secret
 * @returns true se válidas
 */
export function isValidCredentials(accountSid: string, authToken: string): boolean {
  // Account SID deve começar com 'AC' e ter 34 caracteres
  const validAccountSid = /^AC[a-f0-9]{32}$/i.test(accountSid);

  // Auth Token deve ter 32 caracteres hexadecimais
  const validAuthToken = /^[a-f0-9]{32}$/i.test(authToken);

  return validAccountSid && validAuthToken;
}

/**
 * Retorna mensagem de erro amigável baseado no código Twilio
 *
 * @param errorCode - Código de erro do Twilio
 * @returns Mensagem descritiva
 */
export function getFriendlyErrorMessage(errorCode: number): string {
  const errorMessages: Record<number, string> = {
    20003: 'Falha na autenticação. Verifique suas credenciais Twilio.',
    20004: 'Token de autenticação inválido.',
    20005: 'Conta Twilio não está ativa.',
    21211: 'Número de telefone inválido.',
    21408: 'Número de telefone não verificado.',
    21606: 'Sem permissão para enviar SMS para este número.',
    30003: 'Falha na entrega da mensagem.',
    30004: 'Mensagem bloqueada.',
    30005: 'Fila de mensagens cheia.',
    30006: 'Preço da mensagem excede o máximo configurado.',
    30007: 'Não foi possível rotear a mensagem.',
    63016: 'Número WhatsApp não aprovado.',
    63017: 'Limite de taxa do WhatsApp excedido.',
  };

  return errorMessages[errorCode] || `Erro Twilio: código ${errorCode}`;
}
