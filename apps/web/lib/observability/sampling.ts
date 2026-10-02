export function getTraceSampleRate(value: string | undefined, environment: string | undefined) {
  if (value !== undefined && value.trim() !== '') {
    const configured = Number(value);
    if (Number.isFinite(configured) && configured >= 0 && configured <= 1) return configured;
  }
  return environment === 'development' ? 1 : 0.05;
}

export function getMetricSampleRate(value: string | undefined, fallback = 0.1) {
  if (value !== undefined && value.trim() !== '') {
    const configured = Number(value);
    if (Number.isFinite(configured) && configured >= 0 && configured <= 1) return configured;
  }
  return fallback;
}

export function shouldSampleMetric(value: string | undefined, fallback = 0.1) {
  return Math.random() < getMetricSampleRate(value, fallback);
}
