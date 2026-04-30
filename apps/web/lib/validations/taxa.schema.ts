import { z } from 'zod';

/**
 * Schema de validação para taxa de matrícula
 */
export const taxaMatriculaSchema = z
  .object({
    taxaIsenta: z.boolean(),
    taxaMatricula: z.number().min(0, 'Valor da taxa não pode ser negativo'),
    taxaJustificativa: z.string().optional(),
  })
  .refine(
    (data) => {
      // Se isenta, deve ter justificativa (opcional mas recomendado)
      // Se não isenta, deve ter valor > 0
      if (data.taxaIsenta) {
        return true; // Isenção sempre válida
      }
      return data.taxaMatricula > 0;
    },
    {
      message: 'Taxa não isenta deve ter valor maior que zero',
      path: ['taxaMatricula'],
    },
  );

/**
 * Valida se a taxa está configurada corretamente
 */
export function validarTaxaMatricula(
  isenta: boolean,
  valor: number | undefined,
  justificativa: string | undefined,
): { valido: boolean; mensagem: string; tipo: 'success' | 'error' | 'warning' } {
  // Caso 1: Taxa isenta
  if (isenta) {
    if (!justificativa || justificativa.trim().length === 0) {
      return {
        valido: true,
        mensagem: 'Taxa isenta. Considere adicionar justificativa para auditoria.',
        tipo: 'warning',
      };
    }
    return {
      valido: true,
      mensagem: 'Taxa isenta com justificativa registrada',
      tipo: 'success',
    };
  }

  // Caso 2: Taxa cobrada
  if (valor == null || valor <= 0) {
    return {
      valido: false,
      mensagem: 'Valor da taxa deve ser maior que zero',
      tipo: 'error',
    };
  }

  // Validações de valores razoáveis
  if (valor < 50) {
    return {
      valido: true,
      mensagem: 'Valor abaixo do usual. Confirme se está correto.',
      tipo: 'warning',
    };
  }

  if (valor > 500) {
    return {
      valido: true,
      mensagem: 'Valor acima do usual. Confirme se está correto.',
      tipo: 'warning',
    };
  }

  return {
    valido: true,
    mensagem: 'Taxa configurada corretamente',
    tipo: 'success',
  };
}

/**
 * Formata valor de taxa para exibição
 */
export function formatarTaxa(valor: number | undefined): string {
  if (valor == null || isNaN(valor)) return 'R$ 0,00';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

/**
 * Valida justificativa de isenção
 */
export function validarJustificativaIsencao(justificativa: string | undefined): {
  valido: boolean;
  mensagem: string;
} {
  if (!justificativa || justificativa.trim().length === 0) {
    return {
      valido: false,
      mensagem: 'Recomenda-se adicionar justificativa para isenção',
    };
  }

  if (justificativa.trim().length < 10) {
    return {
      valido: false,
      mensagem: 'Justificativa muito curta (mínimo 10 caracteres)',
    };
  }

  if (justificativa.trim().length > 500) {
    return {
      valido: false,
      mensagem: 'Justificativa muito longa (máximo 500 caracteres)',
    };
  }

  return {
    valido: true,
    mensagem: 'Justificativa adequada',
  };
}

/**
 * Sugere valores padrão de taxa baseado no plano
 */
export function sugerirValorTaxa(planoValor: number | undefined): number {
  if (planoValor == null || planoValor <= 0) return 120;

  // Sugestão: 80% do valor do plano, arredondado
  const sugestao = Math.round(planoValor * 0.8);

  // Limita entre 50 e 300
  return Math.min(Math.max(sugestao, 50), 300);
}
