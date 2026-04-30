export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace('R$', '')
    .trim();
};

export function buildSparklinePath(values: number[] | undefined | null, width: number, height: number) {
  if (!Array.isArray(values) || values.length === 0) {
    return { d: '', lastPoint: null as { x: number; y: number } | null };
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = stepX * i;
    const normalized = (v - min) / range;
    const y = height - normalized * height;
    return { x, y };
  });

  // Usa curvas cúbicas (C) para uma linha mais suave
  let d = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];

    const dx = (p1.x - p0.x) / 3;

    const c1x = p0.x + dx;
    const c1y = p0.y;
    const c2x = p1.x - dx;
    const c2y = p1.y;

    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p1.x},${p1.y}`;
  }

  return { d, lastPoint: points[points.length - 1] };
}
