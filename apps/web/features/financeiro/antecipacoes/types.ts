export type AnticipationStatus =
  | 'PENDING'
  | 'DENIED'
  | 'CREDITED'
  | 'DEBITED'
  | 'CANCELLED'
  | 'OVERDUE'
  | 'SCHEDULED';

export type AnticipationContext = {
  source: 'ACADEMIC' | 'STANDALONE' | 'ACADEMIC_INSTALLMENT' | 'STANDALONE_INSTALLMENT' | 'ASAAS_ONLY';
  localId: string | null;
  description: string | null;
  payerName: string | null;
  billingType: string | null;
  dueDate: string | null;
  status: string | null;
  value: number | null;
};

export type AnticipationItem = {
  id: string;
  payment?: string | null;
  installment?: string | null;
  status: AnticipationStatus;
  anticipationDate?: string | null;
  dueDate?: string | null;
  requestDate?: string | null;
  fee: number;
  anticipationDays: number;
  netValue: number;
  totalValue: number;
  value: number;
  denialObservation?: string | null;
  context: AnticipationContext;
};

export type ListAnticipationsResponse = {
  items: AnticipationItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  summary: {
    requestedValue: number;
    netValue: number;
    fees: number;
    credited: number;
    pending: number;
    denied: number;
  };
  fetchedAt: string;
};

export type AnticipationCandidate = {
  id: string;
  targetType: 'PAYMENT' | 'INSTALLMENT';
  payment: string | null;
  installment: string | null;
  description: string | null;
  payerName: string | null;
  billingType: string;
  status: string;
  value: number;
  netValue: number | null;
  dueDate: string | null;
  estimatedCreditDate: string | null;
  invoiceUrl: string | null;
  source: AnticipationContext['source'];
  localId: string | null;
};

export type ListAnticipationCandidatesResponse = {
  items: AnticipationCandidate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  fetchedAt: string;
};

export type AnticipationSimulation = {
  payment?: string | null;
  installment?: string | null;
  anticipationDate?: string | null;
  dueDate?: string | null;
  fee: number;
  anticipationDays: number;
  netValue: number;
  totalValue: number;
  value: number;
  isDocumentationRequired: boolean;
};

export type AnticipationLimits = {
  creditCard?: { total: number; available: number } | null;
  bankSlip?: { total: number; available: number } | null;
};

export type AutomaticAnticipationEligibilityReason = 'PERSON_TYPE_MUST_BE_PJ';

export type AnticipationConfiguration = {
  creditCardAutomaticEnabled: boolean;
  automaticCreditCardEligible: boolean;
  automaticCreditCardReason: AutomaticAnticipationEligibilityReason | null;
  accountPersonType: string | null;
};
