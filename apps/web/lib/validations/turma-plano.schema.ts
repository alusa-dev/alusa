import { z } from 'zod';
import { calcularIdade } from './aluno-responsavel.schema';
import { calcularVagasDisponiveis } from '@alusa/lib';

/**
 * Valida se o aluno está na faixa etária da turma
 */
export function validarFaixaEtaria(
  dataNascAluno: string,
  idadeMin?: number,
  idadeMax?: number,
): { valido: boolean; mensagem?: string } {
  try {
    const idade = calcularIdade(dataNascAluno);

    if (idadeMin !== undefined && idade < idadeMin) {
      return {
        valido: false,
        mensagem: `Aluno tem ${idade} anos. Idade mínima: ${idadeMin} anos`,
      };
    }

    if (idadeMax !== undefined && idade > idadeMax) {
      return {
        valido: false,
        mensagem: `Aluno tem ${idade} anos. Idade máxima: ${idadeMax} anos`,
      };
    }

    return { valido: true };
  } catch {
    return { valido: true }; // Se não conseguir calcular, permite
  }
}

/**
 * Schema para validação de seleção de turma
 */
export const turmaSelecaoSchema = z.object({
  turmaId: z.string().min(1, 'Turma obrigatória'),
  idadeMin: z.number().optional(),
  idadeMax: z.number().optional(),
  capacidade: z.number().optional(),
  vagasOcupadas: z.number().default(0),
  alunoDataNasc: z.string().min(1, 'Data de nascimento do aluno obrigatória'),
});

export type TurmaSelecaoValidation = z.infer<typeof turmaSelecaoSchema>;

/**
 * Valida se a turma tem capacidade disponível.
 * @deprecated Use `calcularVagasDisponiveis` de @alusa/lib diretamente.
 */
export function validarCapacidadeTurma(
  capacidade: number,
  vagasOcupadas: number,
): { valido: boolean; mensagem?: string } {
  const resultado = calcularVagasDisponiveis(capacidade, vagasOcupadas);
  return {
    valido: resultado.temVaga,
    mensagem: resultado.mensagem,
  };
}

/**
 * Schema para validação de seleção de plano
 */
export const planoSelecaoSchema = z.object({
  planoId: z.string().min(1, 'Plano obrigatório'),
  valor: z.number().min(0, 'Valor do plano inválido'),
  periodicidade: z.enum(['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']).optional(),
});

export type PlanoSelecaoValidation = z.infer<typeof planoSelecaoSchema>;

/**
 * Schema combinado: validação de turma/combo + plano
 */
export const turmaPlanoSchema = z
  .object({
    modoTurmas: z.enum(['TURMAS', 'COMBO']),
    turmaId: z.string().optional(),
    comboId: z.string().optional(),
    planoId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.modoTurmas === 'TURMAS') {
        return !!data.turmaId;
      }
      return !!data.comboId;
    },
    {
      message: 'Selecione uma turma ou combo',
      path: ['turmaId'],
    },
  )
  .refine((data) => !!data.planoId, {
    message: 'Plano obrigatório',
    path: ['planoId'],
  });

export type TurmaPlanoValidation = z.infer<typeof turmaPlanoSchema>;

/**
 * Formata horário (ex: "08:00" -> "8h")
 */
export function formatarHorario(hora?: string): string {
  if (!hora) return '--';
  const [h, m] = hora.split(':');
  if (!h) return '--';
  const hNum = parseInt(h, 10);
  if (isNaN(hNum)) return '--';
  if (m === '00' || !m) return `${hNum}h`;
  return `${hNum}h${m}`;
}

/**
 * Formata dias da semana (ex: ["SEG", "QUA"] -> "Seg, Qua")
 */
export function formatarDiasSemana(dias: string[]): string {
  const mapa: Record<string, string> = {
    SEG: 'Seg',
    TER: 'Ter',
    QUA: 'Qua',
    QUI: 'Qui',
    SEX: 'Sex',
    SAB: 'Sáb',
    DOM: 'Dom',
  };
  return dias.map((d) => mapa[d] || d).join(', ');
}
