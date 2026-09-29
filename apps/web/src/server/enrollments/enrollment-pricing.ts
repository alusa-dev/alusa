export type DescontoInput = {
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  cumulativo?: boolean;
};

export type CalcularPrecoInput = {
  planoValor: number;
  taxaMatricula?: number;
  descontos?: DescontoInput[];
};

export type CalcularPrecoOutput = {
  plano: number;
  planoLiquido: number;
  taxa: number;
  descontosAplicados: number[];
  total: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularPrecoMatricula(input: CalcularPrecoInput): CalcularPrecoOutput {
  const plano = Math.max(0, Number(input.planoValor || 0));
  const taxa = Math.max(0, Number(input.taxaMatricula || 0));
  const descontos = input.descontos ?? [];

  const valores = descontos.map((d) => {
    const v = Number(d.valor || 0);
    if (d.tipo === 'PERCENTUAL') return round2(plano * (v / 100));
    return round2(v);
  });

  const hasCumulativo = descontos.some((d) => d.cumulativo);
  const descontosAplicados = hasCumulativo ? valores : valores.length ? [Math.max(...valores)] : [];
  const totalDescontos = round2(descontosAplicados.reduce((acc, n) => acc + n, 0));
  const planoLiquido = Math.max(0, round2(plano - totalDescontos));

  return {
    plano: round2(plano),
    planoLiquido,
    taxa: round2(taxa),
    descontosAplicados,
    total: round2(planoLiquido + taxa),
  };
}
