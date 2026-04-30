import { z } from 'zod';

/**
 * Schema de validação para seleção de plano no wizard de matrícula
 */
export const planoSelecaoSchema = z.object({
  planoId: z.string().min(1, 'Selecione um plano'),
  planoLabel: z.string().optional(),
  planoValor: z.number().positive('Valor do plano deve ser positivo').optional(),
});

/**
 * Valida se o plano selecionado está disponível
 */
export function validarPlanoDisponivel(
  planoId: string | undefined,
  planosDisponiveis: { id: string; ativo?: boolean }[],
): { valido: boolean; mensagem: string } {
  if (!planoId) {
    return {
      valido: false,
      mensagem: 'Nenhum plano selecionado',
    };
  }

  const plano = planosDisponiveis.find((p) => p.id === planoId);

  if (!plano) {
    return {
      valido: false,
      mensagem: 'Plano não encontrado',
    };
  }

  if (plano.ativo === false) {
    return {
      valido: false,
      mensagem: 'Plano inativo e não pode ser usado',
    };
  }

  return {
    valido: true,
    mensagem: 'Plano válido',
  };
}

/**
 * Formata valor monetário para exibição
 */
export function formatarValorPlano(valor: number | undefined): string {
  if (valor == null || isNaN(valor)) return 'Valor não definido';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

/**
 * Calcula o valor final do plano com desconto aplicado
 */
export function calcularValorComDesconto(
  valorBase: number,
  descontoTipo: 'FIXO' | 'PERCENTUAL' | undefined,
  descontoValor: number | undefined,
): number {
  if (!descontoTipo || !descontoValor || descontoValor <= 0) {
    return valorBase;
  }

  if (descontoTipo === 'FIXO') {
    return Math.max(0, valorBase - descontoValor);
  }

  if (descontoTipo === 'PERCENTUAL') {
    const percentual = Math.min(100, Math.max(0, descontoValor));
    return valorBase * (1 - percentual / 100);
  }

  return valorBase;
}

/**
 * Valida se o desconto aplicado é válido
 */
export function validarDesconto(
  valorBase: number,
  descontoTipo: 'FIXO' | 'PERCENTUAL' | undefined,
  descontoValor: number | undefined,
): { valido: boolean; mensagem: string } {
  if (!descontoTipo || descontoValor == null || descontoValor === 0) {
    return { valido: true, mensagem: 'Sem desconto aplicado' };
  }

  if (descontoValor < 0) {
    return {
      valido: false,
      mensagem: 'Valor de desconto deve ser positivo',
    };
  }

  if (descontoTipo === 'FIXO' && descontoValor > valorBase) {
    return {
      valido: false,
      mensagem: 'Desconto fixo não pode ser maior que o valor do plano',
    };
  }

  if (descontoTipo === 'PERCENTUAL' && descontoValor > 100) {
    return {
      valido: false,
      mensagem: 'Desconto percentual não pode ser maior que 100%',
    };
  }

  return { valido: true, mensagem: 'Desconto válido' };
}
