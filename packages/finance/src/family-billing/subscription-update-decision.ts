export type FamilySubscriptionUpdateDecision =
  | { action: 'UPDATE'; desiredValue: number }
  | { action: 'ALREADY_APPLIED'; desiredValue: number }
  | {
      action: 'REQUIRES_RECONCILIATION';
      previousValue: number;
      desiredValue: number;
      remoteValue: number;
    };

function normalizeMoney(value: number) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

function sameMoney(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

export function decideFamilySubscriptionUpdate(input: {
  previousValue: number;
  desiredValue: number;
  remoteValue: number;
}): FamilySubscriptionUpdateDecision {
  const previousValue = normalizeMoney(input.previousValue);
  const desiredValue = normalizeMoney(input.desiredValue);
  const remoteValue = normalizeMoney(input.remoteValue);

  if (sameMoney(remoteValue, desiredValue)) {
    return { action: 'ALREADY_APPLIED', desiredValue };
  }
  if (sameMoney(remoteValue, previousValue)) {
    return { action: 'UPDATE', desiredValue };
  }
  return {
    action: 'REQUIRES_RECONCILIATION',
    previousValue,
    desiredValue,
    remoteValue,
  };
}
