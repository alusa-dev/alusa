import { z } from 'zod';

/**
 * Schema de validação para dados financeiros
 */
export const dadosFinanceirosSchema = z.object({
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  vencimentoDia: z.number().min(1, 'Dia mínimo é 1').max(28, 'Dia máximo é 28'),
  formaPagamento: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'BOLETO'], {
    errorMap: () => ({ message: 'Selecione uma forma de pagamento' }),
  }),
  descontoTipo: z.enum(['FIXO', 'PERCENTUAL']).optional(),
  descontoValor: z.number().min(0, 'Desconto não pode ser negativo').optional(),
  planoValor: z.number().positive('Valor do plano deve ser positivo'),
});

/**
 * Valida data de início da matrícula
 */
export function validarDataInicio(dataInicio: string | undefined): {
  valido: boolean;
  mensagem: string;
  tipo: 'success' | 'error' | 'warning';
} {
  if (!dataInicio) {
    return {
      valido: false,
      mensagem: 'Data de início é obrigatória',
      tipo: 'error',
    };
  }

  const data = new Date(dataInicio);
  if (isNaN(data.getTime())) {
    return {
      valido: false,
      mensagem: 'Data inválida',
      tipo: 'error',
    };
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);

  const diffDias = Math.floor((data.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

  // Data no passado
  if (diffDias < 0) {
    return {
      valido: false,
      mensagem: 'Data de início não pode ser no passado',
      tipo: 'error',
    };
  }

  // Data muito distante no futuro (mais de 90 dias)
  if (diffDias > 90) {
    return {
      valido: true,
      mensagem: 'Data de início está muito distante. Confirme se está correto.',
      tipo: 'warning',
    };
  }

  // Data ideal (próximos 30 dias)
  if (diffDias <= 30) {
    return {
      valido: true,
      mensagem: 'Data de início configurada',
      tipo: 'success',
    };
  }

  return {
    valido: true,
    mensagem: 'Data de início definida',
    tipo: 'success',
  };
}

/**
 * Valida data de fim do contrato
 */
export function validarDataFimContrato(
  dataFimContrato: string | undefined,
  dataInicio: string | undefined,
): {
  valido: boolean;
  mensagem: string;
  tipo: 'success' | 'error' | 'warning';
} {
  if (!dataFimContrato) {
    return {
      valido: false,
      mensagem: 'Data de fim do contrato é obrigatória',
      tipo: 'error',
    };
  }

  const dataFim = new Date(dataFimContrato);
  if (isNaN(dataFim.getTime())) {
    return {
      valido: false,
      mensagem: 'Data de fim do contrato inválida',
      tipo: 'error',
    };
  }

  // Validar que dataFimContrato >= dataInicio
  if (dataInicio) {
    const dataIni = new Date(dataInicio);
    if (!isNaN(dataIni.getTime())) {
      dataFim.setHours(0, 0, 0, 0);
      dataIni.setHours(0, 0, 0, 0);

      if (dataFim < dataIni) {
        return {
          valido: false,
          mensagem: 'Data de fim do contrato não pode ser anterior à data de início',
          tipo: 'error',
        };
      }
    }
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  dataFim.setHours(0, 0, 0, 0);

  const diffDias = Math.floor((dataFim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

  // Data no passado (permitir com aviso)
  if (diffDias < 0) {
    return {
      valido: true,
      mensagem: 'Data de fim do contrato está no passado. Confirme se está correto.',
      tipo: 'warning',
    };
  }

  // Data muito distante no futuro (mais de 2 anos)
  if (diffDias > 730) {
    return {
      valido: true,
      mensagem: 'Data de fim do contrato está muito distante. Confirme se está correto.',
      tipo: 'warning',
    };
  }

  return {
    valido: true,
    mensagem: 'Data de fim do contrato configurada',
    tipo: 'success',
  };
}

/**
 * Valida dia de vencimento
 */
export function validarDiaVencimento(dia: number | undefined): {
  valido: boolean;
  mensagem: string;
} {
  if (dia == null) {
    return {
      valido: false,
      mensagem: 'Dia de vencimento é obrigatório',
    };
  }

  if (!Number.isInteger(dia)) {
    return {
      valido: false,
      mensagem: 'Dia deve ser um número inteiro',
    };
  }

  if (dia < 1 || dia > 28) {
    return {
      valido: false,
      mensagem: 'Dia deve estar entre 1 e 28',
    };
  }

  // Dias recomendados (5, 10, 15, 20, 25)
  const diasRecomendados = [5, 10, 15, 20, 25];
  if (diasRecomendados.includes(dia)) {
    return {
      valido: true,
      mensagem: 'Dia de vencimento recomendado',
    };
  }

  return {
    valido: true,
    mensagem: 'Dia de vencimento configurado',
  };
}

/**
 * Valida forma de pagamento
 */
export function validarFormaPagamento(formaPagamento: string | undefined): {
  valido: boolean;
  mensagem: string;
} {
  if (!formaPagamento) {
    return {
      valido: false,
      mensagem: 'Selecione uma forma de pagamento',
    };
  }

  const formasValidas = ['DINHEIRO', 'PIX', 'CARTAO', 'BOLETO'];
  if (!formasValidas.includes(formaPagamento)) {
    return {
      valido: false,
      mensagem: 'Forma de pagamento inválida',
    };
  }

  return {
    valido: true,
    mensagem: 'Forma de pagamento selecionada',
  };
}

/**
 * Calcula valor final com desconto aplicado
 */
export function calcularValorFinal(
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

  // PERCENTUAL
  const percentual = Math.min(100, Math.max(0, descontoValor));
  return valorBase * (1 - percentual / 100);
}

/**
 * Valida desconto financeiro
 */
export function validarDescontoFinanceiro(
  valorBase: number,
  descontoTipo: 'FIXO' | 'PERCENTUAL' | undefined,
  descontoValor: number | undefined,
): { valido: boolean; mensagem: string; tipo: 'success' | 'error' | 'warning' } {
  // Sem desconto é válido
  if (!descontoTipo || !descontoValor || descontoValor === 0) {
    return {
      valido: true,
      mensagem: 'Sem desconto aplicado',
      tipo: 'success',
    };
  }

  // Validações básicas
  if (descontoValor < 0) {
    return {
      valido: false,
      mensagem: 'Desconto não pode ser negativo',
      tipo: 'error',
    };
  }

  // Desconto FIXO
  if (descontoTipo === 'FIXO') {
    if (descontoValor > valorBase) {
      return {
        valido: false,
        mensagem: 'Desconto fixo não pode ser maior que o valor do plano',
        tipo: 'error',
      };
    }

    const percentualDesconto = (descontoValor / valorBase) * 100;
    if (percentualDesconto > 50) {
      return {
        valido: true,
        mensagem: `Desconto alto (${percentualDesconto.toFixed(0)}%). Confirme se está correto.`,
        tipo: 'warning',
      };
    }

    return {
      valido: true,
      mensagem: `Desconto de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(descontoValor)} aplicado`,
      tipo: 'success',
    };
  }

  // Desconto PERCENTUAL
  if (descontoTipo === 'PERCENTUAL') {
    if (descontoValor > 100) {
      return {
        valido: false,
        mensagem: 'Desconto percentual não pode ser maior que 100%',
        tipo: 'error',
      };
    }

    if (descontoValor > 50) {
      return {
        valido: true,
        mensagem: `Desconto alto (${descontoValor}%). Confirme se está correto.`,
        tipo: 'warning',
      };
    }

    return {
      valido: true,
      mensagem: `Desconto de ${descontoValor}% aplicado`,
      tipo: 'success',
    };
  }

  return {
    valido: true,
    mensagem: 'Desconto configurado',
    tipo: 'success',
  };
}

/**
 * Formata valor monetário
 */
export function formatarValorMonetario(valor: number | undefined): string {
  if (valor == null || isNaN(valor)) return 'R$ 0,00';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

/**
 * Formata data para exibição
 */
export function formatarData(data: string | undefined): string {
  if (!data) return '—';

  try {
    const date = new Date(data);
    if (isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

/**
 * Gera resumo do desconto aplicado
 */
export function gerarResumoDesconto(
  valorBase: number,
  descontoTipo: 'FIXO' | 'PERCENTUAL' | undefined,
  descontoValor: number | undefined,
): { temDesconto: boolean; textoDesconto: string; valorDesconto: number; valorFinal: number } {
  if (!descontoTipo || !descontoValor || descontoValor <= 0) {
    return {
      temDesconto: false,
      textoDesconto: 'Sem desconto',
      valorDesconto: 0,
      valorFinal: valorBase,
    };
  }

  const valorFinal = calcularValorFinal(valorBase, descontoTipo, descontoValor);
  const valorDesconto = valorBase - valorFinal;

  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const textoDesconto =
    descontoTipo === 'FIXO'
      ? `Desconto fixo: ${formatter.format(descontoValor)}`
      : `Desconto: ${descontoValor}%`;

  return {
    temDesconto: true,
    textoDesconto,
    valorDesconto,
    valorFinal,
  };
}
