export type Student = {
  id: string;
  name: string;
  photo: string | null;
  status: string;
};

export type StudentListResponse = {
  students: Student[];
};

export type StudentAddress = {
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
};

export type StudentResponsible = {
  id: string;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  financial: boolean;
  photo: string | null;
  address: StudentAddress | null;
  communicationConsent: boolean;
  marketingConsent: boolean;
};

export type StudentEnrollment = {
  id: string;
  status: string;
  financialStatus: string;
  contractStatus: string;
  startDate: string | null;
  endDate: string | null;
  contractEndDate: string | null;
  paymentDay: number | null;
  enrollmentFee: number | null;
  enrollmentFeeStatus: string | null;
  enrollmentFeeExempt: boolean;
  paymentMethod: string | null;
  enrollmentFeePaymentMethod: string | null;
  class: { id: string; name: string; modality: string | null } | null;
  classes: Array<{ id: string; name: string; modality: string | null }>;
  plan: { id: string; name: string; value: number; frequency: string } | null;
  combo: { id: string; name: string; value: number; frequency: string } | null;
  contract: { id: string; status: string; signedAt: string | null; createdAt: string } | null;
  contracts: Array<{ id: string; status: string; signedAt: string | null; createdAt: string }>;
};

export type StudentCharge = {
  id: string;
  description: string;
  amount: number;
  dueDate: string | null;
  paidAt: string | null;
  status: string;
  paymentMethod: string | null;
  type: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  createdAt: string;
};

export type StudentAgreement = {
  id: string;
  status: string;
  value: number;
  frequency: string;
  nextDate: string | null;
  createdAt: string;
  kind: 'SUBSCRIPTION' | 'INSTALLMENT';
  installments: number | null;
  paymentMethod: string | null;
};

export type StudentNotificationPreference = {
  id: string;
  event: string;
  scheduleOffset: number;
  enabled: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
};

export type StudentNotifications = {
  source: 'student' | 'responsible' | 'unavailable';
  recipientName: string | null;
  preferences: StudentNotificationPreference[];
};

export type StudentDetail = Student & {
  asaasCustomerId: string | null;
  socialName: string | null;
  birthDate: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  status: 'ATIVO' | 'INATIVO' | string;
  address: StudentAddress | null;
  notes: string | null;
  gender: string | null;
  mainModality: string | null;
  level: string | null;
  allergies: string | null;
  medicalRestrictions: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  registrationOrigin: string | null;
  discountPercent: number | null;
  registrationFeeExempt: boolean;
  imageConsent: boolean;
  communicationConsent: boolean;
  marketingConsent: boolean;
  shirtSize: string | null;
  shoeSize: string | null;
  internalCode: string | null;
  tags: string[];
  deactivatedAt: string | null;
  deactivationReason: string | null;
  responsible: StudentResponsible | null;
  responsibles: StudentResponsible[];
  enrollments: StudentEnrollment[];
  charges: StudentCharge[];
  agreements: StudentAgreement[];
  notifications: StudentNotifications;
};
