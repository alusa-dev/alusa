/**
 * Twilio Integration Module
 *
 * Módulo centralizado para integração com Twilio (WhatsApp e SMS).
 *
 * @module lib/twilio
 *
 * @example
 * ```ts
 * import { getTwilioService } from '@/lib/twilio';
 *
 * const service = getTwilioService();
 * const result = await service.sendMessage({
 *   numero: '11987654321',
 *   mensagem: 'Olá do Alusa!',
 *   tipo: 'whatsapp'
 * });
 * ```
 */

// ============================================================================
// Schemas e Types
// ============================================================================

export * from './schemas';
export * from './types';

// ============================================================================
// Service
// ============================================================================

export {
  TwilioService,
  createTwilioService,
  getTwilioService,
  resetTwilioService,
} from './service';

export { default as TwilioServiceDefault } from './service';

// ============================================================================
// Utils
// ============================================================================

export {
  formatarNumeroWhatsApp,
  formatarNumeroSMS,
  formatarNumeroTelefone,
  parsePhoneNumber,
  formatPhoneNumberDetailed,
  isValidTwilioNumber,
  extractPhoneNumber,
  isValidMessageLength,
  calculateSmsSegments,
  formatSid,
  parseTwilioDate,
  formatPrice,
  sanitizeMessage,
  generateMessageId,
  isValidCredentials,
  getFriendlyErrorMessage,
  removeNonDigits,
} from './utils';

// ============================================================================
// Credentials
// ============================================================================

export {
  getTwilioCredentials,
  saveTwilioCredentials,
  deleteTwilioCredentials,
  hasTwilioCredentials,
  getTwilioCredentialsFromEnv,
  getTwilioCredentialsAny,
  validateTwilioCredentials,
  updateTwilioFromNumber,
} from './credentials';
