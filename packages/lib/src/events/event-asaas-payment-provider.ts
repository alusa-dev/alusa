export type EventAsaasCustomer = {
  id: string;
  deleted?: boolean;
};

export type EventAsaasPayment = {
  id: string;
  status?: string;
  invoiceUrl?: string | null;
  deleted?: boolean;
};

export type EventPixQrCode = {
  encodedImage: string;
  payload: string;
  expirationDate: string;
};

export type EventAsaasPaymentProvider = {
  listCustomers(_params: {
    apiKey: string;
    cpfCnpj?: string;
    externalReference?: string;
    limit?: number;
  }): Promise<{ data: EventAsaasCustomer[] }>;
  createCustomer(_params: {
    apiKey: string;
    idempotencyKey?: string;
    data: {
      name: string;
      email?: string;
      cpfCnpj: string;
      address?: string;
      addressNumber?: string;
      complement?: string;
      province?: string;
      postalCode?: string;
      externalReference?: string;
      notificationDisabled?: boolean;
    };
  }): Promise<EventAsaasCustomer>;
  updateCustomer(_params: {
    apiKey: string;
    customerId: string;
    data: {
      name?: string;
      email?: string;
      address?: string;
      addressNumber?: string;
      complement?: string;
      province?: string;
      postalCode?: string;
      externalReference?: string;
      notificationDisabled?: boolean;
    };
  }): Promise<EventAsaasCustomer>;
  createPayment(_params: {
    apiKey: string;
    idempotencyKey?: string;
    data: {
      customer: string;
      value: number;
      dueDate: string;
      billingType: string;
      description?: string;
      externalReference?: string;
    };
  }): Promise<EventAsaasPayment>;
  listPayments(_params: {
    apiKey: string;
    externalReference?: string;
    limit?: number;
  }): Promise<{ data: EventAsaasPayment[] }>;
  getPixQrCode(_params: { apiKey: string; paymentId: string }): Promise<EventPixQrCode>;
  deletePayment(_params: { apiKey: string; paymentId: string }): Promise<EventAsaasPayment>;
};

let eventAsaasPaymentProvider: EventAsaasPaymentProvider | null = null;

export function registerEventAsaasPaymentProvider(provider: EventAsaasPaymentProvider): void {
  eventAsaasPaymentProvider = provider;
}

export function getEventAsaasPaymentProvider(): EventAsaasPaymentProvider {
  if (!eventAsaasPaymentProvider) {
    throw new Error('Event Asaas payment provider not registered');
  }

  return eventAsaasPaymentProvider;
}
