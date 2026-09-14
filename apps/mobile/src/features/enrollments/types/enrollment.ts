export type EnrollmentClass = {
  id: string;
  name: string;
  schedule: {
    days: string[];
    startTime: string;
    endTime: string;
  };
  occupancy: {
    enrolled: number;
    capacity: number;
  };
  status: 'ATIVO' | 'INATIVO';
};

export type EnrollmentClassListResponse = {
  classes: EnrollmentClass[];
};

export type EnrollmentStudent = {
  id: string;
  enrollmentId: string;
  name: string;
  photo: string | null;
};

export type EnrollmentClassDetailResponse = {
  class: EnrollmentClass & {
    students: EnrollmentStudent[];
  };
};

export type EnrollmentDetail = {
  id: string;
  status: string;
  financialStatus: string;
  contractStatus: string;
  startDate: string;
  endDate: string | null;
  contractEndDate: string;
  paymentDay: number;
  enrollmentFee: number;
  enrollmentFeeStatus: string;
  enrollmentFeeExempt: boolean;
  paymentMethod: string | null;
  enrollmentFeePaymentMethod: string | null;
  interestPercent: number | null;
  finePercent: number | null;
  discountPercent: number | null;
  discountLimitDays: number | null;
  pause: {
    active: boolean;
    startedAt: string | null;
    expectedReturnAt: string | null;
    keepsSeat: boolean;
    chargesDuringPause: boolean;
    reason: string | null;
  };
  integration: { status: string; warning: string | null };
  student: { id: string; name: string; photo: string | null; cpf: string | null; email: string | null; phone: string | null; customer: string | null };
  responsible: { id: string; name: string; email: string | null; phone: string | null } | null;
  class: { id: string; name: string; modality: string; days: string[]; startTime: string; endTime: string } | null;
  classes: Array<{ id: string; name: string; modality: string; days: string[]; startTime: string; endTime: string }>;
  plan: { id: string; name: string; value: number; frequency: string } | null;
  combo: { id: string; name: string; value: number; frequency: string } | null;
  contracts: Array<{ id: string; status: string; signedAt: string | null; createdAt: string }>;
  charges: Array<{ id: string; description: string; type: string; status: string; amount: number; dueDate: string; paidAt: string | null; paymentMethod: string; createdAt: string }>;
  options: {
    plans: Array<{ id: string; name: string; value: number; frequency: string }>;
    classes: Array<{ id: string; name: string }>;
  };
};

export type EnrollmentUpdateInput = {
  dataFimContrato?: string;
  vencimentoDia?: number;
  turmaId?: string | null;
  planoId?: string | null;
  comboId?: string | null;
  paymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO';
};
