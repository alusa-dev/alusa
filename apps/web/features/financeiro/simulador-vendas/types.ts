export type PaymentSimulationResult = {
  requestedValue: number;
  simulatedValue: number;
  installmentCount: number;
  passFeesToCustomer: boolean;
  paymentValue: number;
  paymentNetValue: number;
  feeValue: number;
  feePercentage: number | null;
  operationFee: number | null;
};

export type SimulationStatus = 'idle' | 'loading' | 'success' | 'error';
