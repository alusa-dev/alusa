import { z } from 'zod';

/**
 * Schema completo de validação da matrícula antes da submissão
 */
export const resumoMatriculaSchema = z
  .object({
    // Dados do aluno
    aluno: z.object({
      id: z.string().min(1, 'Aluno é obrigatório'),
      nome: z.string().min(1, 'Nome do aluno é obrigatório'),
      dataNasc: z.string().optional(),
      responsavel: z
        .object({
          id: z.string().min(1, 'Responsável é obrigatório'),
          nome: z.string().min(1, 'Nome do responsável é obrigatório'),
        })
        .optional(),
    }),

    // Turmas ou Combo
    modoTurmas: z.enum(['COMBO', 'TURMAS']),
    turmaIds: z.array(z.string()).optional(),
    comboId: z.string().optional(),
    comboValor: z.number().optional(), // valor do combo (R$)
    comboPeriodicidade: z.string().optional(), // periodicidade do combo

    // Plano (opcional quando comboId é fornecido)
    planoId: z.string().optional(),
    planoValor: z.number().optional(),

    // Taxa
    taxaIsenta: z.boolean(),
    taxaMatricula: z.number().min(0, 'Taxa não pode ser negativa'),

    // Financeiro
    dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de início inválida'),
    dataFimContrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de fim do contrato inválida'),
    vencimentoDia: z.number().min(1).max(28, 'Dia de vencimento inválido'),
    formaPagamento: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_CREDITO', 'BOLETO']),
    modeloId: z.string().min(1, 'Modelo de contrato é obrigatório'),
    notificationChannels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).default([]),
    notificationChannelsConfigured: z.boolean().default(false),

    // Confirmação
    confirmacaoRevisao: z.boolean().refine((val) => val === true, {
      message: 'Você deve revisar e confirmar os dados antes de continuar',
    }),
  })
  .refine(
    (data) => {
      // Se modo TURMAS, deve ter pelo menos uma turma
      if (data.modoTurmas === 'TURMAS') {
        return data.turmaIds && data.turmaIds.length > 0;
      }
      // Se modo COMBO, deve ter comboId
      return !!data.comboId;
    },
    {
      message: 'Selecione uma turma ou combo',
      path: ['turmaIds'],
    },
  )
  .refine(
    (data) => {
      // Se modo TURMAS, planoId é obrigatório
      if (data.modoTurmas === 'TURMAS') {
        return !!data.planoId && data.planoId.length > 0;
      }
      // Se modo COMBO, planoId é opcional (combo define valor/periodicidade)
      return true;
    },
    {
      message: 'Selecione um plano',
      path: ['planoId'],
    },
  )
  .refine(
    (data) => {
      // Valida que existe valor: comboValor quando COMBO, planoValor quando TURMAS
      if (data.modoTurmas === 'COMBO') {
        return typeof data.comboValor === 'number' && data.comboValor > 0;
      }
      return typeof data.planoValor === 'number' && data.planoValor > 0;
    },
    {
      message: 'Valor inválido',
      path: ['planoValor'],
    },
  )
  .refine(
    (data) => {
      // Validar que dataFimContrato >= dataInicio
      if (!data.dataInicio || !data.dataFimContrato) return true; // Validação básica já foi feita
      const inicio = new Date(data.dataInicio);
      const fim = new Date(data.dataFimContrato);
      if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) return true; // Validação de formato já foi feita
      return fim >= inicio;
    },
    {
      message: 'Data de fim do contrato deve ser posterior ou igual à data de início',
      path: ['dataFimContrato'],
    },
  );

/**
 * Valida se todos os dados necessários estão preenchidos
 */
export function validarMatriculaCompleta(state: Record<string, unknown>): {
  valido: boolean;
  camposFaltando: string[];
  mensagens: string[];
} {
  const camposFaltando: string[] = [];
  const mensagens: string[] = [];

  // Valida aluno
  if (!state.aluno || typeof state.aluno !== 'object') {
    camposFaltando.push('aluno');
    mensagens.push('Selecione um aluno');
  } else {
    const aluno = state.aluno as Record<string, unknown>;
    if (!aluno.id) {
      camposFaltando.push('aluno.id');
      mensagens.push('Aluno não foi selecionado corretamente');
    }
  }

  // Valida turmas/combo
  if (state.modoTurmas === 'TURMAS') {
    const turmaIds = state.turmaIds as unknown[];
    if (!turmaIds || !Array.isArray(turmaIds) || turmaIds.length === 0) {
      camposFaltando.push('turmaIds');
      mensagens.push('Selecione pelo menos uma turma');
    }
  } else if (state.modoTurmas === 'COMBO') {
    if (!state.comboId) {
      camposFaltando.push('comboId');
      mensagens.push('Selecione um combo');
    }
  }

  // Valida plano - só obrigatório quando NÃO é combo (combo define valor/periodicidade)
  if (state.modoTurmas !== 'COMBO' && !state.planoId) {
    camposFaltando.push('planoId');
    mensagens.push('Selecione um plano');
  }

  // Valida taxa (apenas se não for isenta)
  if (state.taxaIsenta !== true) {
    const taxaMatricula = Number(state.taxaMatricula ?? 0);
    if (Number.isNaN(taxaMatricula) || taxaMatricula <= 0) {
      camposFaltando.push('taxaMatricula');
      mensagens.push('Informe o valor da taxa de matrícula');
    }
  }

  // Valida dados financeiros
  if (!state.dataInicio) {
    camposFaltando.push('dataInicio');
    mensagens.push('Defina a data de início');
  }

  if (!state.dataFimContrato) {
    camposFaltando.push('dataFimContrato');
    mensagens.push('Defina a data de fim do contrato');
  }

  if (!state.vencimentoDia) {
    camposFaltando.push('vencimentoDia');
    mensagens.push('Defina o dia de vencimento');
  }

  if (!state.formaPagamento) {
    camposFaltando.push('formaPagamento');
    mensagens.push('Selecione a forma de pagamento');
  }

  if (!state.modeloId) {
    camposFaltando.push('modeloId');
    mensagens.push('Selecione um modelo de contrato');
  }

  if (state.confirmacaoRevisao !== true) {
    camposFaltando.push('confirmacaoRevisao');
    mensagens.push('Você deve revisar e confirmar os dados');
  }

  return {
    valido: camposFaltando.length === 0,
    camposFaltando,
    mensagens,
  };
}

/**
 * Calcula idade do aluno
 */
export function calcularIdadeAluno(dataNasc: string | undefined): number | null {
  if (!dataNasc) return null;

  const nasc = new Date(dataNasc);
  if (isNaN(nasc.getTime())) return null;

  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const monthDiff = hoje.getMonth() - nasc.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && hoje.getDate() < nasc.getDate())) {
    idade -= 1;
  }

  return idade;
}

/**
 * Gera resumo financeiro completo
 */
export function gerarResumoFinanceiro(state: {
  planoValor?: number;
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  beneficioSelecionado?: {
    tipo?: 'FIXO' | 'PERCENTUAL';
    valor?: number;
  } | null;
}): {
  valorPlano: number;
  valorPlanoLiquido: number;
  valorBeneficio: number;
  valorTaxa: number;
  totalInicial: number;
} {
  const valorPlano = state.planoValor ?? 0;
  const beneficio = state.beneficioSelecionado;
  const valorBeneficio = beneficio
    ? beneficio.tipo === 'PERCENTUAL'
      ? Math.max(0, Math.min(valorPlano, valorPlano * ((beneficio.valor ?? 0) / 100)))
      : Math.max(0, Math.min(valorPlano, beneficio.valor ?? 0))
    : 0;
  const valorPlanoLiquido = Math.max(0, valorPlano - valorBeneficio);
  const valorTaxa = state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0);
  const totalInicial = valorTaxa + valorPlanoLiquido;

  return {
    valorPlano,
    valorPlanoLiquido,
    valorBeneficio,
    valorTaxa,
    totalInicial,
  };
}

/**
 * Formata forma de pagamento para exibição
 */
export function formatarFormaPagamento(forma: string | undefined): string {
  if (!forma) return '—';

  const mapa: Record<string, string> = {
    DINHEIRO: 'Dinheiro',
    PIX: 'PIX',
    CARTAO: 'Cartão de Crédito',
    CARTAO_CREDITO: 'Cartão de Crédito',
    BOLETO: 'Boleto Bancário',
  };

  return mapa[forma] ?? forma;
}

/**
 * Gera texto descritivo do modo de turmas
 */
export function descreverModoTurmas(state: {
  modoTurmas: 'COMBO' | 'TURMAS';
  turmaLabel?: string;
  comboLabel?: string;
  turmaIds?: string[];
  comboId?: string;
}): string {
  if (state.modoTurmas === 'COMBO') {
    return state.comboLabel ?? `Combo ${state.comboId}`;
  }

  // Modo TURMAS
  if (state.turmaIds && state.turmaIds.length === 1) {
    return state.turmaLabel ?? `Turma ${state.turmaIds[0]}`;
  }

  if (state.turmaIds && state.turmaIds.length > 1) {
    return `${state.turmaIds.length} turmas selecionadas`;
  }

  return '—';
}

/**
 * Valida e retorna warnings importantes para revisão
 */
export function gerarWarningsRevisao(state: {
  taxaIsenta?: boolean;
  taxaJustificativa?: string;
  descontoAntecipado?: number;
  descontoTipo?: 'FIXED' | 'PERCENTAGE';
  planoValor?: number;
  dataInicio?: string;
}): string[] {
  const warnings: string[] = [];

  // Warning: Taxa isenta sem justificativa
  if (
    state.taxaIsenta &&
    (!state.taxaJustificativa || state.taxaJustificativa.trim().length < 10)
  ) {
    warnings.push('⚠️ Taxa isenta sem justificativa detalhada');
  }

  // Warning: Desconto alto (para desconto antecipado do Asaas)
  if (state.descontoAntecipado && state.descontoAntecipado > 0 && state.planoValor) {
    const percentual =
      state.descontoTipo === 'PERCENTAGE'
        ? state.descontoAntecipado
        : (state.descontoAntecipado / state.planoValor) * 100;

    if (percentual > 30) {
      warnings.push(`⚠️ Desconto antecipado alto (${percentual.toFixed(0)}%)`);
    }
  }

  // Warning: Data de início muito distante
  if (state.dataInicio) {
    const data = new Date(state.dataInicio);
    const hoje = new Date();
    const diffDias = Math.floor((data.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDias > 60) {
      warnings.push(`⚠️ Data de início está ${diffDias} dias no futuro`);
    }
  }

  return warnings;
}

/**
 * Prepara payload para submissão da matrícula
 */
export function prepararPayloadMatricula(state: Record<string, unknown>): {
  valido: boolean;
  payload?: Record<string, unknown>;
  erros: string[];
} {
  console.log('[prepararPayloadMatricula] Estado recebido:', JSON.stringify(state, null, 2));

  const validacao = validarMatriculaCompleta(state);

  if (!validacao.valido) {
    console.log('[prepararPayloadMatricula] Validação falhou:', validacao.mensagens);
    return {
      valido: false,
      erros: validacao.mensagens,
    };
  }

  const modoBeneficio = state.modoBeneficio === 'COM' ? 'COM' : 'SEM';
  if (modoBeneficio === 'COM' && !(state.beneficioSelecionado as { id?: string } | undefined)?.id) {
    return {
      valido: false,
      erros: ['Selecione um benefício para esta matrícula.'],
    };
  }

  const normalizePayment = (value: unknown) => {
    if (typeof value !== 'string') return value;
    return value === 'CARTAO' ? 'CARTAO_CREDITO' : value;
  };

  // Monta payload
  const payload = {
    // Aluno e responsável
    alunoId: (state.aluno as Record<string, unknown>)?.id,
    responsavelFinanceiroId: (
      (state.aluno as Record<string, unknown>)?.responsavel as Record<string, unknown>
    )?.id,

    // Turma ou Combo
    turmaId: state.modoTurmas === 'TURMAS' ? (state.turmaIds as string[])[0] : undefined,
    comboId: state.modoTurmas === 'COMBO' ? state.comboId : undefined,

    // Plano - só inclui se NÃO for combo (combo define valor/periodicidade)
    planoId: state.modoTurmas === 'COMBO' ? undefined : state.planoId,

    // Taxa
    taxaMatricula: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
    taxaIsenta: state.taxaIsenta ?? false,
    taxaJustificativa: state.taxaJustificativa,
    formaPagamentoTaxa: normalizePayment(state.formaPagamentoTaxa),
    pagarTaxaAgora: state.pagarTaxaAgora ?? false,
    gerarCobrancaTaxa: state.gerarCobrancaTaxa ?? false,

    // Financeiro
    dataInicio: state.dataInicio,
    dataFimContrato: state.dataFimContrato,
    vencimentoDia: state.vencimentoDia,
    formaPagamento: normalizePayment(state.formaPagamento),
    modeloId: state.modeloId,
    notificationChannels: Array.isArray(state.notificationChannels) ? state.notificationChannels : [],
    notificationChannelsConfigured: state.notificationChannelsConfigured === true,

    // Juros, Multa e Desconto (conforme Asaas API)
    multaPercentual: state.multaPercentual,
    jurosMensal: state.jurosMensal,
    descontoAntecipado: state.descontoAntecipado,
    descontoTipo: state.descontoTipo, // 'FIXED' ou 'PERCENTAGE'
    prazoDesconto: state.prazoDesconto,
    descontoIds:
      (state.beneficioSelecionado as { origem?: string; id?: string } | undefined)?.origem ===
      'CATALOGO'
        ? [(state.beneficioSelecionado as { id?: string } | undefined)?.id].filter(Boolean)
        : [],

    // Metadata
    criarCobranca: state.criarCobranca ?? true,
    contaId: state.contaId,
  };

  console.log('[prepararPayloadMatricula] Payload criado:', JSON.stringify(payload, null, 2));

  return {
    valido: true,
    payload,
    erros: [],
  };
}
