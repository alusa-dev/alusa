import { z } from 'zod';

export const dashboardPeriodoDTOSchema = z.enum(['1d', '7d', '15d', '30d', '1a']).default('30d');
export type DashboardPeriodoDTO = z.infer<typeof dashboardPeriodoDTOSchema>;

export const dashboardUltimaCobrancaDTOSchema = z.object({
  id: z.string(),
  aluno: z.string(),
  valor: z.number(),
  vencimento: z.string(),
  status: z.string(),
});

export type DashboardUltimaCobrancaDTO = z.infer<typeof dashboardUltimaCobrancaDTOSchema>;

export const dashboardAlunoRecenteDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  foto: z.string().nullable().optional(),
  tipo: z.string(),
});

export type DashboardAlunoRecenteDTO = z.infer<typeof dashboardAlunoRecenteDTOSchema>;

export const dashboardAniversarianteDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  foto: z.string().nullable().optional(),
  dia: z.number().int().min(1).max(31),
  mes: z.number().int().min(1).max(12),
  dataNascimento: z.string(),
});

export type DashboardAniversarianteDTO = z.infer<typeof dashboardAniversarianteDTOSchema>;

export const dashboardMetricsDataDTOSchema = z.object({
  totalAlunos: z.number().int().nonnegative(),
  alunosAtivos: z.number().int().nonnegative(),
  turmasAtivas: z.number().int().nonnegative(),
  aulasHoje: z.number().int().nonnegative(),
  pendencias: z.number().int().nonnegative(),
  aniversariantesDoMesAtivos: z.number().int().nonnegative(),
  totalMatriculas: z.number().int().nonnegative(),
  matriculasAtivas: z.number().int().nonnegative(),
  cobrancasPendentes: z.number().int().nonnegative(),
  cobrancasVencidas: z.number().int().nonnegative(),
  receitaMes: z.number(),
  aguardandoPagamentoProximos30Dias: z.number(),
  taxaMatriculaRecebidaAno: z.number(),
  receitaTotal: z.number(),
  proximosVencimentos: z.number().int().nonnegative(),
  taxaInadimplencia: z.number(),
  receitaSemanal: z.array(z.number()),
  matriculasNovasSemanal: z.array(z.number().int()),
  matriculasCanceladasSemanal: z.array(z.number().int()),
  ultimasCobrancas: z.array(dashboardUltimaCobrancaDTOSchema),
  alunosRecentes: z.array(dashboardAlunoRecenteDTOSchema),
  aniversariantesDoMes: z.array(dashboardAniversarianteDTOSchema),
});

export type DashboardMetricsDataDTO = z.infer<typeof dashboardMetricsDataDTOSchema>;

export const dashboardMetricsResultDTOSchema = z.object({
  success: z.literal(true),
  data: dashboardMetricsDataDTOSchema,
});

export type DashboardMetricsResultDTO = z.infer<typeof dashboardMetricsResultDTOSchema>;

export const dashboardSerieResultDataDTOSchema = z.object({
  receitaMes: z.number().optional(),
  receitaMesAnterior: z.number().optional(),
  totalTaxas: z.number().optional(),
  totalTaxasAnterior: z.number().optional(),
  variacaoPercentual: z.number().nullable(),
  serie: z.array(z.number()),
  serieAcumulada: z.array(z.number()),
  periodo: z.string(),
});

export type DashboardSerieResultDataDTO = z.infer<typeof dashboardSerieResultDataDTOSchema>;

export const dashboardSerieResultDTOSchema = z.object({
  success: z.literal(true),
  data: dashboardSerieResultDataDTOSchema,
});

export type DashboardSerieResultDTO = z.infer<typeof dashboardSerieResultDTOSchema>;
