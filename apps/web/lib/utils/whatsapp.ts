/**
 * Utilitários para formatação de números WhatsApp
 * @module lib/utils/whatsapp
 */

/**
 * Formata número de telefone brasileiro para identificador WhatsApp.
 *
 * @example
 * formatarNumeroWhatsApp("(97) 98110-6749") // "whatsapp:+5597981106749"
 * formatarNumeroWhatsApp("97981106749") // "whatsapp:+5597981106749"
 * formatarNumeroWhatsApp("+5597981106749") // "whatsapp:+5597981106749"
 * formatarNumeroWhatsApp("5597981106749") // "whatsapp:+5597981106749"
 *
 * @param numero - Número de telefone em qualquer formato
 * @returns Número formatado no padrão whatsapp:+55DDDNÚMERO
 * @throws Error se número for inválido ou vazio
 */
export function formatarNumeroWhatsApp(numero: string): string {
  // Remove todos os caracteres não numéricos
  const apenasNumeros = numero.replace(/\D/g, '');

  // Valida se há números
  if (!apenasNumeros) {
    throw new Error('Número inválido: nenhum dígito encontrado');
  }

  // Se já tem DDI 55 no início, usa direto
  if (apenasNumeros.startsWith('55')) {
    return `whatsapp:+${apenasNumeros}`;
  }

  // Caso contrário, adiciona DDI 55 (Brasil)
  return `whatsapp:+55${apenasNumeros}`;
}
