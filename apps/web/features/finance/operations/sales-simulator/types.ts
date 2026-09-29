export type PaymentSimulationResult = {
  requestedValue: number;
  chargeValue: number;
  installmentCount: number;
  netValue: number;
  installmentValue: number;
  installmentNetValue: number;
  feeValue: number;
  feePercentage: number | null;
  operationFee: number | null;
};

export type SimulationStatus = 'idle' | 'loading' | 'success' | 'error';
