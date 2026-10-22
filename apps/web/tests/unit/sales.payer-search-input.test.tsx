/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';
import { PayerSearchInput, type PayerSearchState } from '@/features/finance/operations/components/PayerSearchInput';
import { SelectedSaleCustomerSummary } from '@/features/sales/components/SelectedSaleCustomerSummary';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

afterEach(cleanup);

describe('PayerSearchInput sales display', () => {
  it('shows grouped student names and financial responsible without CPF, including after selection', () => {
    const candidate: FinancePayerCandidateDTO = {
      id: 'resp-1',
      name: 'Bryan de Alencar Bezerra',
      type: 'responsavel',
      cpf: '04410435264',
      cpfMasked: '044.104.352-64',
      isMinor: false,
      hasResponsible: false,
      responsibleId: null,
      responsibleName: null,
      salesDisplayName: 'Maria Nevez e Nicole Bezerra',
      salesStudentCount: 2,
      payerResolved: {
        type: 'responsavel',
        id: 'resp-1',
        name: 'Bryan de Alencar Bezerra',
        hasAsaasCustomerId: true,
      },
      financialStatus: 'OK',
    };
    const search: PayerSearchState = {
      searchQuery: 'Bryan',
      setSearchQuery: vi.fn(),
      searchResults: [candidate],
      searching: false,
      searchOpen: true,
      setSearchOpen: vi.fn(),
      selectedPayer: null,
      handleSelectPayer: vi.fn(),
      clearSelection: vi.fn(),
    };

    const { rerender } = render(<PayerSearchInput search={search} salesDisplay />);

    expect(screen.getByText('Maria Nevez e Nicole Bezerra')).toBeInTheDocument();
    expect(screen.getByText('Alunos')).toBeInTheDocument();
    expect(screen.getByText('Responsável financeiro: Bryan de Alencar Bezerra')).toBeInTheDocument();
    expect(screen.queryByText(/CPF:/)).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveClass('divide-y', 'divide-gray-100');

    const selectedSearch = { ...search, selectedPayer: candidate, searchOpen: false };
    rerender(<PayerSearchInput search={selectedSearch} salesDisplay />);
    expect(screen.getByRole('textbox')).toHaveValue('Maria Nevez e Nicole Bezerra');

    const singleStudent: FinancePayerCandidateDTO = {
      ...candidate,
      id: 'aluno-1',
      name: 'Maria Eduarda Nevez',
      type: 'aluno',
      salesDisplayName: undefined,
      salesStudentCount: undefined,
      payerResolved: {
        type: 'responsavel',
        id: 'resp-1',
        name: 'Bryan de Alencar Bezerra',
        hasAsaasCustomerId: true,
      },
      responsibleId: 'resp-1',
      responsibleName: 'Bryan de Alencar Bezerra',
      hasResponsible: true,
    };
    rerender(<PayerSearchInput search={{ ...search, searchResults: [singleStudent] }} salesDisplay />);
    expect(screen.getByText('Aluno')).toBeInTheDocument();
    expect(screen.getByText('Maria Eduarda Nevez')).toBeInTheDocument();

    rerender(<PayerSearchInput search={{ ...search, selectedPayer: singleStudent, searchOpen: false }} salesDisplay />);
    expect(screen.getByRole('textbox')).toHaveValue('Maria Eduarda Nevez');

    const singleStudentResponsible: FinancePayerCandidateDTO = {
      ...candidate,
      salesDisplayName: 'Maria Eduarda Nevez',
      salesStudentCount: 1,
    };
    rerender(<PayerSearchInput search={{ ...search, searchResults: [singleStudentResponsible] }} salesDisplay />);
    expect(screen.getByText('Aluno')).toBeInTheDocument();
    expect(screen.getByText('Maria Eduarda Nevez')).toBeInTheDocument();
  });

  it('summarizes the student group and identifies who will be charged', () => {
    const customer: FinancePayerCandidateDTO = {
      id: 'resp-1',
      name: 'Bryan de Alencar Bezerra',
      type: 'responsavel',
      isMinor: false,
      hasResponsible: false,
      responsibleId: null,
      responsibleName: null,
      salesDisplayName: 'Maria Nevez e Nicole Bezerra',
      salesStudentCount: 2,
      payerResolved: {
        type: 'responsavel',
        id: 'resp-1',
        name: 'Bryan de Alencar Bezerra',
        hasAsaasCustomerId: true,
      },
      financialStatus: 'INCOMPLETE',
    };

    render(<SelectedSaleCustomerSummary customer={customer} />);

    expect(screen.getByText('Maria Nevez e Nicole Bezerra')).toBeInTheDocument();
    expect(screen.getByText('Alunos')).toBeInTheDocument();
    expect(screen.getByText('Cobrança em nome de')).toBeInTheDocument();
    expect(screen.getByText('Bryan de Alencar Bezerra')).toBeInTheDocument();
    expect(screen.getByText('Responsável financeiro')).toBeInTheDocument();
    expect(screen.getByText(/Cadastro financeiro incompleto/)).toBeInTheDocument();
  });
});
