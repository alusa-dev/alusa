/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('listbox')).toHaveClass('divide-y', 'divide-gray-100');

    const selectedSearch = { ...search, selectedPayer: candidate, searchOpen: false };
    rerender(<PayerSearchInput search={selectedSearch} salesDisplay />);
    expect(screen.getByRole('combobox')).toHaveValue('Maria Nevez e Nicole Bezerra');

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
    expect(screen.getByRole('combobox')).toHaveValue('Maria Eduarda Nevez');

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

  it('supports keyboard navigation and selection in the combobox', () => {
    const candidate: FinancePayerCandidateDTO = {
      id: 'student-keyboard', name: 'Maria Silva', type: 'aluno', isMinor: false,
      hasResponsible: false, responsibleId: null, responsibleName: null,
      payerResolved: { type: 'aluno', id: 'student-keyboard', name: 'Maria Silva', hasAsaasCustomerId: false },
      financialStatus: 'INCOMPLETE',
    };
    const search: PayerSearchState = {
      searchQuery: 'Maria', setSearchQuery: vi.fn(), searchResults: [candidate], searching: false,
      searchOpen: true, setSearchOpen: vi.fn(), selectedPayer: null,
      handleSelectPayer: vi.fn(), clearSelection: vi.fn(),
    };
    render(<PayerSearchInput search={search} salesDisplay />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/^payer-option-.*-option-0$/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(search.handleSelectPayer).toHaveBeenCalledWith(candidate);
  });

  it('explains that a minor without a responsible may complete a cash sale', () => {
    const customer: FinancePayerCandidateDTO = {
      id: 'minor-cash', name: 'Aluno Menor', type: 'aluno', isMinor: true,
      hasResponsible: false, responsibleId: null, responsibleName: null,
      payerResolved: { type: 'aluno', id: 'minor-cash', name: 'Aluno Menor', hasAsaasCustomerId: false },
      financialStatus: 'INCOMPLETE',
    };
    render(<SelectedSaleCustomerSummary customer={customer} />);
    expect(screen.getByText(/Venda à vista permitida/)).toBeInTheDocument();
    expect(screen.getByText(/cadastre um responsável financeiro/)).toBeInTheDocument();
  });

  it('shows the pending state during debounce instead of a false empty result', () => {
    const search: PayerSearchState = {
      searchQuery: 'Maria', setSearchQuery: vi.fn(), searchResults: [], searching: true,
      searchOpen: true, setSearchOpen: vi.fn(), selectedPayer: null,
      handleSelectPayer: vi.fn(), clearSelection: vi.fn(),
    };
    render(<PayerSearchInput search={search} />);
    expect(screen.getByText('Buscando...')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum resultado')).not.toBeInTheDocument();
  });
});
