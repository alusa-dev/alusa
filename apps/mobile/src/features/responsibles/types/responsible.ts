export type Responsible = {
  id: string;
  name: string;
  photo: string | null;
  cpf: string;
  email: string;
  phone: string;
  financial: boolean;
  status: string;
  communicationConsent: boolean;
  marketingConsent: boolean;
  studentsCount: number;
};

export type ResponsibleAddress = {
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
};

export type ResponsibleStudent = {
  id: string;
  name: string;
  photo: string | null;
  status: string;
  relationship: string;
};

export type ResponsibleEnrollment = {
  id: string;
  studentId: string;
  studentName: string;
  status: string;
  financialStatus: string;
  contractStatus: string;
  startDate: string;
  contractEndDate: string;
  planName: string | null;
  comboName: string | null;
  className: string | null;
};

export type ResponsibleCharge = {
  id: string;
  description: string;
  amount: number;
  dueDate: string | null;
  status: string;
  paymentMethod: string | null;
  createdAt: string;
};

export type ResponsibleAgreement = {
  id: string;
  kind: 'SUBSCRIPTION' | 'INSTALLMENT';
  status: string;
  value: number;
  frequency: string;
  nextDate: string | null;
  installments: number | null;
  name: string;
  createdAt: string;
};

export type ResponsibleDetail = Responsible & {
  customer: string | null;
  userId: string | null;
  address: ResponsibleAddress | null;
  createdAt: string;
  updatedAt: string;
  metrics: { students: number; enrollments: number; sales: number };
  students: ResponsibleStudent[];
  enrollments: ResponsibleEnrollment[];
  charges: ResponsibleCharge[];
  agreements: ResponsibleAgreement[];
};

export type ResponsibleListResponse = { responsibles: Responsible[] };
export type ResponsibleDetailResponse = { responsible: ResponsibleDetail };
