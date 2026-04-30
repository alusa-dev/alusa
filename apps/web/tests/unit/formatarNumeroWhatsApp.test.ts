import { describe, it, expect } from 'vitest';
import { formatarNumeroWhatsApp } from '@/lib/utils/whatsapp';

describe('formatarNumeroWhatsApp', () => {
  it('formata número nacional corretamente', () => {
    expect(formatarNumeroWhatsApp('(97) 98110-6749')).toBe('whatsapp:+5597981106749');
  });

  it('formata número sem máscara', () => {
    expect(formatarNumeroWhatsApp('97981106749')).toBe('whatsapp:+5597981106749');
  });

  it('formata número com DDD de São Paulo', () => {
    expect(formatarNumeroWhatsApp('(11) 99999-9999')).toBe('whatsapp:+5511999999999');
  });

  it('não duplica +55 se já presente', () => {
    expect(formatarNumeroWhatsApp('+5597981106749')).toBe('whatsapp:+5597981106749');
  });

  it('não duplica +55 se já presente sem +', () => {
    expect(formatarNumeroWhatsApp('5597981106749')).toBe('whatsapp:+5597981106749');
  });

  it('mantém formato whatsapp: se já presente', () => {
    expect(formatarNumeroWhatsApp('whatsapp:+5597981106749')).toBe('whatsapp:+5597981106749');
  });

  it('lança erro para número vazio', () => {
    expect(() => formatarNumeroWhatsApp('')).toThrow('Número inválido');
  });

  it('lança erro para string sem dígitos', () => {
    expect(() => formatarNumeroWhatsApp('abc-def')).toThrow('Número inválido');
  });

  it('remove espaços e caracteres especiais', () => {
    expect(formatarNumeroWhatsApp('(97) 9 8110-6749')).toBe('whatsapp:+5597981106749');
  });

  it('funciona com diferentes formatos de máscara', () => {
    expect(formatarNumeroWhatsApp('97 98110 6749')).toBe('whatsapp:+5597981106749');
    expect(formatarNumeroWhatsApp('97-98110-6749')).toBe('whatsapp:+5597981106749');
    expect(formatarNumeroWhatsApp('(97)98110-6749')).toBe('whatsapp:+5597981106749');
  });
});
