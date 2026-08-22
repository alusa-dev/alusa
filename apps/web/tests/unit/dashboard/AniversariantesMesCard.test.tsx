import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AniversariantesMesCard } from '@/app/(app)/dashboard/components/AniversariantesMesCard';

const currentMonth = new Date().getMonth() + 1;
const currentYear = new Date().getFullYear();

describe('AniversariantesMesCard', () => {
  it('exibe alunos e colaboradores no mesmo mês', () => {
    const month = String(currentMonth).padStart(2, '0');

    const { getByText } = render(
      <AniversariantesMesCard
        aniversariantes={[
          {
            id: 'aluno-1',
            nome: 'Aluno do Mês',
            tipo: 'ALUNO',
            foto: null,
            avatarUrl: null,
            dia: 10,
            mes: currentMonth,
            dataNascimento: `${currentYear - 10}-${month}-10T12:00:00.000Z`,
          },
          {
            id: 'colaborador-1',
            nome: 'Colaborador do Mês',
            tipo: 'COLABORADOR',
            foto: null,
            avatarUrl: null,
            dia: 17,
            mes: currentMonth,
            dataNascimento: `${currentYear - 30}-${month}-17T12:00:00.000Z`,
          },
        ]}
      />,
    );

    expect(getByText('Aluno Mês')).toBeInTheDocument();
    expect(getByText('Colaborador Mês')).toBeInTheDocument();
  });

  it('exibe somente o primeiro e o último nome', () => {
    const { getByText, queryByText } = render(
      <AniversariantesMesCard
        aniversariantes={[
          {
            id: 'aluno-1',
            nome: 'José Carlos de Souza',
            tipo: 'ALUNO',
            foto: null,
            avatarUrl: null,
            dia: 10,
            mes: currentMonth,
            dataNascimento: `${currentYear - 10}-${String(currentMonth).padStart(2, '0')}-10T12:00:00.000Z`,
          },
        ]}
      />,
    );

    expect(getByText('José Souza')).toBeInTheDocument();
    expect(queryByText('José Carlos de Souza')).not.toBeInTheDocument();
  });
});
