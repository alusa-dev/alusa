/**
 * Twilio Utils - Unit Tests
 *
 * Testes unitários para funções auxiliares do módulo Twilio.
 */

import { describe, it, expect } from 'vitest';
import {
  removeNonDigits,
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
} from '../utils';

describe('removeNonDigits', () => {
  it('deve remover todos os caracteres não-numéricos', () => {
    expect(removeNonDigits('(11) 98765-4321')).toBe('11987654321');
    expect(removeNonDigits('+55 11 9 8765-4321')).toBe('5511987654321');
    expect(removeNonDigits('abc123def456')).toBe('123456');
  });

  it('deve retornar string vazia para entrada sem números', () => {
    expect(removeNonDigits('abc')).toBe('');
    expect(removeNonDigits('---')).toBe('');
  });
});

describe('formatarNumeroWhatsApp', () => {
  it('deve formatar número brasileiro sem código do país', () => {
    expect(formatarNumeroWhatsApp('11987654321')).toBe('whatsapp:+5511987654321');
    expect(formatarNumeroWhatsApp('21987654321')).toBe('whatsapp:+5521987654321');
  });

  it('deve formatar número brasileiro com código do país', () => {
    expect(formatarNumeroWhatsApp('5511987654321')).toBe('whatsapp:+5511987654321');
  });

  it('deve formatar número com caracteres especiais', () => {
    expect(formatarNumeroWhatsApp('(11) 98765-4321')).toBe('whatsapp:+5511987654321');
    expect(formatarNumeroWhatsApp('+55 11 9 8765-4321')).toBe('whatsapp:+5511987654321');
  });

  it('deve adicionar 9º dígito para números antigos', () => {
    expect(formatarNumeroWhatsApp('1187654321')).toBe('whatsapp:+5511987654321');
  });

  it('deve lançar erro para número muito curto', () => {
    expect(() => formatarNumeroWhatsApp('123')).toThrow('Número muito curto');
  });

  it('deve lançar erro para número inválido', () => {
    expect(() => formatarNumeroWhatsApp('123456789012345678')).toThrow('formato inválido');
  });
});

describe('formatarNumeroSMS', () => {
  it('deve formatar número para SMS (sem prefixo whatsapp)', () => {
    expect(formatarNumeroSMS('11987654321')).toBe('+5511987654321');
    expect(formatarNumeroSMS('5511987654321')).toBe('+5511987654321');
  });

  it('deve formatar número SMS com caracteres especiais', () => {
    expect(formatarNumeroSMS('(11) 98765-4321')).toBe('+5511987654321');
  });
});

describe('formatarNumeroTelefone', () => {
  it('deve formatar para whatsapp por padrão', () => {
    const result = formatarNumeroTelefone('11987654321');
    expect(result).toBe('whatsapp:+5511987654321');
  });

  it('deve formatar para SMS quando especificado', () => {
    const result = formatarNumeroTelefone('11987654321', 'sms');
    expect(result).toBe('+5511987654321');
  });

  it('deve formatar para WhatsApp quando especificado', () => {
    const result = formatarNumeroTelefone('11987654321', 'whatsapp');
    expect(result).toBe('whatsapp:+5511987654321');
  });
});

describe('parsePhoneNumber', () => {
  it('deve fazer parse de número brasileiro completo', () => {
    const result = parsePhoneNumber('5511987654321');
    expect(result).toEqual({
      countryCode: '55',
      areaCode: '11',
      localNumber: '987654321',
      e164: '+5511987654321',
      national: '(11) 98765-4321',
    });
  });

  it('deve fazer parse de número fixo', () => {
    const result = parsePhoneNumber('551134567890');
    expect(result).toEqual({
      countryCode: '55',
      areaCode: '11',
      localNumber: '34567890',
      e164: '+551134567890',
      national: '(11) 3456-7890',
    });
  });

  it('deve retornar null para número não-brasileiro', () => {
    expect(parsePhoneNumber('14155238886')).toBeNull();
  });

  it('deve retornar null para número inválido', () => {
    expect(parsePhoneNumber('123')).toBeNull();
  });
});

describe('formatPhoneNumberDetailed', () => {
  it('deve retornar resultado detalhado para whatsapp', () => {
    const result = formatPhoneNumberDetailed('5511987654321', 'whatsapp');

    expect(result.formatted).toBe('whatsapp:+5511987654321');
    expect(result.type).toBe('whatsapp');
    expect(result.original).toBe('5511987654321');
    expect(result.parsed).toBeDefined();
    expect(result.parsed?.areaCode).toBe('11');
  });

  it('deve retornar resultado detalhado para SMS', () => {
    const result = formatPhoneNumberDetailed('11987654321', 'sms');

    expect(result.formatted).toBe('+5511987654321');
    expect(result.type).toBe('sms');
  });
});

describe('isValidTwilioNumber', () => {
  it('deve validar número WhatsApp formatado', () => {
    expect(isValidTwilioNumber('whatsapp:+5511987654321')).toBe(true);
    expect(isValidTwilioNumber('whatsapp:+14155238886')).toBe(true);
  });

  it('deve validar número SMS formatado', () => {
    expect(isValidTwilioNumber('+5511987654321')).toBe(true);
    expect(isValidTwilioNumber('+14155238886')).toBe(true);
  });

  it('deve rejeitar número não formatado', () => {
    expect(isValidTwilioNumber('11987654321')).toBe(false);
    expect(isValidTwilioNumber('5511987654321')).toBe(false);
  });

  it('deve rejeitar número com tamanho inválido', () => {
    expect(isValidTwilioNumber('whatsapp:+123')).toBe(false);
    expect(isValidTwilioNumber('+12345678901234567890')).toBe(false);
  });
});

describe('extractPhoneNumber', () => {
  it('deve extrair número do formato WhatsApp', () => {
    expect(extractPhoneNumber('whatsapp:+5511987654321')).toBe('5511987654321');
  });

  it('deve extrair número do formato SMS', () => {
    expect(extractPhoneNumber('+5511987654321')).toBe('5511987654321');
  });

  it('deve retornar número já limpo', () => {
    expect(extractPhoneNumber('5511987654321')).toBe('5511987654321');
  });
});

describe('isValidMessageLength', () => {
  it('deve validar mensagem com comprimento válido', () => {
    expect(isValidMessageLength('Olá!')).toBe(true);
    expect(isValidMessageLength('A'.repeat(1600))).toBe(true);
  });

  it('deve rejeitar mensagem vazia', () => {
    expect(isValidMessageLength('')).toBe(false);
  });

  it('deve rejeitar mensagem muito longa', () => {
    expect(isValidMessageLength('A'.repeat(1601))).toBe(false);
  });
});

describe('calculateSmsSegments', () => {
  it('deve calcular 1 segmento para mensagem curta', () => {
    expect(calculateSmsSegments('Olá!')).toBe(1);
    expect(calculateSmsSegments('A'.repeat(160))).toBe(1);
  });

  it('deve calcular múltiplos segmentos para mensagem longa', () => {
    expect(calculateSmsSegments('A'.repeat(161))).toBe(2);
    expect(calculateSmsSegments('A'.repeat(320))).toBe(2);
    expect(calculateSmsSegments('A'.repeat(321))).toBe(3);
  });

  it('deve usar limite de 70 caracteres para Unicode', () => {
    expect(calculateSmsSegments('Olá! 😀')).toBe(1);
    expect(calculateSmsSegments('😀'.repeat(71))).toBe(3); // 71 emojis = 142 chars, logo 3 segmentos de 70
  });
});

describe('formatSid', () => {
  it('deve formatar SID longo', () => {
    expect(formatSid('SM1234567890abcdef1234567890abcd')).toBe('SM12...abcd');
  });

  it('deve retornar SID curto sem formatação', () => {
    expect(formatSid('SM12345')).toBe('SM12345');
  });
});

describe('parseTwilioDate', () => {
  it('deve converter string ISO para Date', () => {
    const result = parseTwilioDate('2025-01-02T10:30:00Z');
    expect(result).toBeInstanceOf(Date);
  });

  it('deve retornar Date quando entrada já é Date', () => {
    const date = new Date();
    expect(parseTwilioDate(date)).toBe(date);
  });

  it('deve retornar null para entrada null', () => {
    expect(parseTwilioDate(null)).toBeNull();
  });

  it('deve retornar null para string inválida', () => {
    const result = parseTwilioDate('invalid-date');
    // A função agora valida se é Invalid Date e retorna null
    expect(result).toBeNull();
  });
});

describe('formatPrice', () => {
  it('deve formatar preço positivo', () => {
    expect(formatPrice('0.0075', 'USD')).toBe('$0.01');
    expect(formatPrice('1.50', 'USD')).toBe('$1.50');
  });

  it('deve formatar preço negativo', () => {
    expect(formatPrice('-0.0075', 'USD')).toBe('-$0.01');
  });

  it('deve retornar $0.00 para null', () => {
    expect(formatPrice(null)).toBe('$0.00');
  });
});

describe('sanitizeMessage', () => {
  it('deve remover caracteres de controle', () => {
    const result = sanitizeMessage('Olá\n\r\tMundo');
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\t');
  });

  it('deve normalizar espaços múltiplos', () => {
    expect(sanitizeMessage('Olá     Mundo')).toBe('Olá Mundo');
  });

  it('deve remover espaços das extremidades', () => {
    expect(sanitizeMessage('  Olá Mundo  ')).toBe('Olá Mundo');
  });
});

describe('generateMessageId', () => {
  it('deve gerar ID único', () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();

    expect(id1).toMatch(/^msg_[a-z0-9]+_[a-z0-9]+$/);
    expect(id2).toMatch(/^msg_[a-z0-9]+_[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });
});

describe('isValidCredentials', () => {
  it('deve validar credenciais corretas', () => {
    const accountSid = 'AC' + 'a'.repeat(32);
    const authToken = 'b'.repeat(32);
    expect(isValidCredentials(accountSid, authToken)).toBe(true);
  });

  it('deve rejeitar Account SID sem prefixo AC', () => {
    const accountSid = 'XX' + 'a'.repeat(32);
    const authToken = 'b'.repeat(32);
    expect(isValidCredentials(accountSid, authToken)).toBe(false);
  });

  it('deve rejeitar Account SID com tamanho incorreto', () => {
    const accountSid = 'AC123';
    const authToken = 'b'.repeat(32);
    expect(isValidCredentials(accountSid, authToken)).toBe(false);
  });

  it('deve rejeitar Auth Token com tamanho incorreto', () => {
    const accountSid = 'AC' + 'a'.repeat(32);
    const authToken = 'short';
    expect(isValidCredentials(accountSid, authToken)).toBe(false);
  });
});

describe('getFriendlyErrorMessage', () => {
  it('deve retornar mensagem amigável para erros conhecidos', () => {
    expect(getFriendlyErrorMessage(20003)).toContain('autenticação');
    expect(getFriendlyErrorMessage(21211)).toContain('inválido');
    expect(getFriendlyErrorMessage(30003)).toContain('entrega');
    expect(getFriendlyErrorMessage(63016)).toContain('WhatsApp');
  });

  it('deve retornar mensagem genérica para erro desconhecido', () => {
    const message = getFriendlyErrorMessage(99999);
    expect(message).toContain('código 99999');
  });
});
