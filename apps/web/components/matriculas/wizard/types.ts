export type ModoMatricula = 'INDIVIDUAL' | 'FAMILIAR';

export type StepId =
  | 'modo'
  | 'aluno'
  | 'responsavelFamiliar'
  | 'alunosFamiliares'
  | 'turmasCombo'
  | 'taxa'
  | 'plano'
  | 'bolsaBeneficios'
  | 'jurosMulta'
  | 'notificacoes'
  | 'financeiro'
  | 'resumo';

export interface WizardAlunoFamiliar {
  id: string;
  nome: string;
  dataNasc?: string;
  foto?: string;
  cpf?: string;
  ativo?: boolean;
  turmaId?: string;
  turmaLabel?: string;
  comboId?: string;
  comboLabel?: string;
  comboValor?: number;
  comboPeriodicidade?: string;
}

export interface WizardFamiliarSubmitResult {
  alunoId: string;
  alunoNome: string;
  status: 'success' | 'error';
  matriculaId?: string;
  errorMessage?: string;
}

export type WizardNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface WizardAluno {
  id: string;
  nome: string;
  dataNasc?: string;
  responsavel?: { id: string; nome: string } | null;
  ativo?: boolean;
  cpf?: string;
  foto?: string;
  email?: string;
  telefone?: string;
}

export interface WizardBeneficio {
  id: string;
  nome: string;
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  escopo: string;
  origem: 'CATALOGO';
}

export interface WizardState {
  contaId: string;
  modoMatricula: ModoMatricula;
  aluno?: WizardAluno;
  responsavelFamiliar?: { id: string; nome: string };
  alunosFamiliares: WizardAlunoFamiliar[];
  modoTurmas: 'COMBO' | 'TURMAS';
  comboId?: string;
  turmaIds: string[];
  turmaLabel?: string; // label amigável da turma selecionada (MVP 1 turma)
  comboLabel?: string; // label amigável do combo selecionado
  comboValor?: number; // valor do combo (R$)
  comboPeriodicidade?: string; // periodicidade do combo
  planoId?: string;
  planoLabel?: string;
  planoValor?: number; // valor base do plano
  modoBeneficio?: 'SEM' | 'COM';
  beneficioSelecionado?: WizardBeneficio | null;
  modeloId?: string;
  modeloNome?: string;
  vencimentoDia?: number;
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  taxaJustificativa?: string;
  formaPagamentoTaxa?: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_CREDITO' | 'BOLETO';
  pagarTaxaAgora?: boolean; // Flag para pagar taxa imediatamente
  gerarCobrancaTaxa?: boolean;
  formaPagamento?: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_CREDITO' | 'BOLETO';
  criarCobranca: boolean;
  dataInicio?: string; // ISO ou yyyy-mm-dd
  dataFimContrato?: string; // ISO ou yyyy-mm-dd (data de fim do contrato - obrigatório)
  // Campos de juros, multa e desconto (conforme Asaas API)
  multaPercentual?: number; // fine.value - percentual da multa
  jurosMensal?: number; // interest.value - percentual de juros ao mês
  descontoAntecipado?: number; // discount.value - valor do desconto
  descontoTipo?: 'FIXED' | 'PERCENTAGE'; // discount.type - tipo do desconto
  prazoDesconto?: number; // discount.dueDateLimitDays - dias antes do vencimento
  notificationChannels: WizardNotificationChannel[];
  notificationChannelsInitialized?: boolean;
  /** @deprecated Prefer notificationChannelsTouched — mantido para compatibilidade de payload */
  notificationChannelsConfigured?: boolean;
  /** True quando o usuário alterou os toggles de canal (dispara sync no Asaas). */
  notificationChannelsTouched?: boolean;
  confirmacaoRevisao: boolean;
}

export interface WizardContextValue {
  state: WizardState;
  step: StepId;
  steps: StepId[];
  canGoBack: boolean;
  goNext: () => void;
  goBack: () => void;
  update: (_patch: Partial<WizardState>) => void;
  reset: (_opts?: Partial<WizardState>) => void;
}
