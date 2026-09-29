import type {
  FinancialClassOccupancyItem,
  FinancialEnrollmentHealth,
  FinancialMetricSummary,
} from '../dtos';

export type BusinessHealthLevel = 'healthy' | 'stable' | 'attention' | 'critical' | 'empty';

export type BusinessHealthScore = {
  level: BusinessHealthLevel;
  label: string;
  description: string;
  score: number | null;
  coverage: number;
  indicators: {
    payments: number | null;
    occupancy: number | null;
    retention: number | null;
    efficiency: number | null;
  };
};

const WEIGHTS = {
  payments: 45,
  occupancy: 30,
  retention: 15,
  efficiency: 10,
} as const;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentage(part: number, total: number): number {
  return total > 0 ? clamp((part / total) * 100) : 0;
}

function weightedOccupancy(items: FinancialClassOccupancyItem[]): number | null {
  const capacity = items.reduce((total, item) => total + item.capacity, 0);
  if (capacity <= 0) return null;
  const occupied = items.reduce((total, item) => total + item.occupiedSeats, 0);
  return clamp((occupied / capacity) * 100, 0, 150);
}

function occupancyStrength(rate: number): number {
  if (rate <= 80) return clamp((rate / 80) * 100);
  if (rate <= 100) return 100;
  return clamp(100 - (rate - 100) * 2.5);
}

function diagnosticDescription(params: {
  delinquencyRate: number;
  occupancyRate: number | null;
  retentionRate: number | null;
  efficiency: number | null;
  level: BusinessHealthLevel;
}): string {
  const risks = [
    {
      severity: params.delinquencyRate,
      message: `A inadimplência de ${params.delinquencyRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% é o principal risco para o caixa.`,
    },
    ...(params.occupancyRate === null
      ? []
      : [
          {
            severity: Math.max(0, 80 - params.occupancyRate),
            message: `A ocupação está em ${params.occupancyRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das vagas disponíveis.`,
          },
        ]),
    ...(params.retentionRate === null
      ? []
      : [
          {
            severity: Math.max(0, 100 - params.retentionRate),
            message: `A permanência recente estimada está em ${params.retentionRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%.`,
          },
        ]),
    ...(params.efficiency === null
      ? []
      : [
          {
            severity: Math.max(0, 100 - params.efficiency),
            message: `A eficiência líquida dos recebimentos está em ${params.efficiency.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%.`,
          },
        ]),
  ].sort((left, right) => right.severity - left.severity);
  if (params.level === 'healthy')
    return 'Pagamentos, ocupação e permanência sustentam o estado atual da operação.';
  return risks[0]?.message ?? 'Ainda não há dados suficientes para identificar o principal risco.';
}

export function calculateBusinessHealthScore(params: {
  summary: FinancialMetricSummary;
  classOccupancy: FinancialClassOccupancyItem[];
  enrollmentHealth: FinancialEnrollmentHealth;
}): BusinessHealthScore {
  const paymentBase = params.summary.received + params.summary.overdue;
  const paymentRealization =
    paymentBase > 0 ? percentage(params.summary.received, paymentBase) : null;
  const paymentStrength =
    paymentRealization === null
      ? null
      : clamp((100 - params.summary.delinquencyRate) * 0.7 + paymentRealization * 0.3);
  const occupancyRate = weightedOccupancy(params.classOccupancy);
  const occupancyScore = occupancyRate === null ? null : occupancyStrength(occupancyRate);
  const retention = params.enrollmentHealth.retentionRate;
  const efficiency =
    params.summary.received > 0 ? percentage(params.summary.net, params.summary.received) : null;
  const indicators = {
    payments: paymentStrength,
    occupancy: occupancyRate,
    retention,
    efficiency,
  };
  const dimensionScores = {
    payments: paymentStrength,
    occupancy: occupancyScore,
    retention,
    efficiency,
  };
  const available = Object.entries(dimensionScores).filter(
    (entry): entry is [keyof typeof dimensionScores, number] => entry[1] !== null,
  );
  const coverage = available.reduce((total, [key]) => total + WEIGHTS[key], 0);
  if (coverage === 0) {
    return {
      level: 'empty',
      label: 'Sem dados suficientes',
      description: 'Ainda não há dados financeiros ou operacionais para avaliar a escola.',
      score: null,
      coverage: 0,
      indicators,
    };
  }
  const weighted = available.reduce(
    (total, [key, value]) => total + value * (WEIGHTS[key] / coverage),
    0,
  );
  let score = Math.round(weighted);
  if (paymentStrength !== null) {
    if (params.summary.delinquencyRate >= 25) score = Math.min(score, 39);
    else if (params.summary.delinquencyRate >= 15) score = Math.min(score, 49);
    else if (params.summary.delinquencyRate >= 8) score = Math.min(score, 69);
  }
  if (occupancyRate !== null) {
    if (occupancyRate < 30) score = Math.min(score, 59);
    else if (occupancyRate < 50) score = Math.min(score, 74);
  }
  if (retention !== null) {
    if (retention < 70) score = Math.min(score, 49);
    else if (retention < 85) score = Math.min(score, 69);
  }
  const level: BusinessHealthLevel =
    score < 50 ? 'critical' : score < 70 ? 'attention' : score < 85 ? 'stable' : 'healthy';
  const label = {
    critical: 'Saúde crítica',
    attention: 'Requer atenção',
    stable: 'Operação estável',
    healthy: 'Negócio saudável',
    empty: 'Sem dados suficientes',
  }[level];
  return {
    level,
    label,
    description: diagnosticDescription({
      delinquencyRate: params.summary.delinquencyRate,
      occupancyRate,
      retentionRate: retention,
      efficiency,
      level,
    }),
    score,
    coverage,
    indicators,
  };
}

export function businessScoreColor(position: number): string {
  const stops = [
    { score: 0, hue: 0 },
    { score: 50, hue: 24 },
    { score: 70, hue: 42 },
    { score: 85, hue: 96 },
    { score: 100, hue: 142 },
  ];
  const value = clamp(position);
  const upperIndex = stops.findIndex((stop) => stop.score >= value);
  if (upperIndex <= 0) return `hsl(${stops[0].hue} 84% 58%)`;
  const upper = stops[upperIndex];
  const lower = stops[upperIndex - 1];
  const ratio = (value - lower.score) / (upper.score - lower.score);
  const hue = lower.hue + (upper.hue - lower.hue) * ratio;
  return `hsl(${hue} 84% 52%)`;
}
