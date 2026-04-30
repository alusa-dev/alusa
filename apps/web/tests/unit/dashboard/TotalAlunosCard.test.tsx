// Necessário para JSX nos testes (runtime manual)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react';
void React;
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TotalAlunosCard } from '@/app/(app)/dashboard/components/TotalAlunosCard';

describe('TotalAlunosCard', () => {
  it('exibe totais e fallback quando não há alunos recentes', () => {
    render(<TotalAlunosCard total={8} ativos={1} recentes={[]} onAddAluno={() => {}} />);

    const card = screen.getByLabelText('Resumo do total de alunos');
    expect(card).toHaveTextContent('8');

    expect(card).toHaveTextContent('Sem cadastros recentes');
  });

  it('renderiza avatars e dispara callback ao clicar em adicionar', async () => {
    const handleAdd = vi.fn();
    render(
      <TotalAlunosCard
        total={12}
        ativos={7}
        recentes={[
          { id: '1', nome: 'Ana Souza', foto: null },
          { id: '2', nome: 'Bruno Lima', foto: null },
        ]}
        onAddAluno={handleAdd}
      />
    );


    const addButtons = screen.getAllByTestId('add-student-btn');
    addButtons.forEach((button) => fireEvent.click(button));
    expect(handleAdd).toHaveBeenCalled();
  });
});
