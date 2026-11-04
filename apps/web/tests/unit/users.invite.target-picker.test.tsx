/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InviteTargetPicker from '@/features/users/components/invite/InviteTargetPicker';
import type { InviteCandidateDTO } from '@/features/users/dtos';

function candidate(overrides: Partial<InviteCandidateDTO> = {}): InviteCandidateDTO {
  return {
    kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-1', name: 'Ana Professora',
    email: 'ana@example.test', students: [], accessStatus: 'NONE', inviteStatus: 'NONE', canInvite: true,
    ...overrides,
  };
}

function response(items: InviteCandidateDTO[], page = 1, limit = 20, hasMore = false) {
  return { ok: true, json: async () => ({ items, page, limit, hasMore }) };
}

describe('InviteTargetPicker', () => {
  const fetchMock = vi.fn();
  const onTargetChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(response([candidate()]));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('debounces tenant candidates, supports keyboard selection, and emits canonical collaborator target', async () => {
    render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    const input = screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ana' } });

    const option = await screen.findByRole('option', { name: /Ana Professora/ });
    const candidateRequests = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/users/invite/candidates?'));
    expect(candidateRequests).toHaveLength(1);
    expect(candidateRequests[0][0]).toContain('recordType=COLABORADOR');
    expect(candidateRequests[0][0]).toContain('q=Ana');
    expect(candidateRequests[0][1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onTargetChange).toHaveBeenLastCalledWith({
      kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-1', role: 'PROFESSOR',
    }, expect.objectContaining({ recordId: 'employee-1' }));
    expect(screen.getByText('Ana Professora')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trocar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' })));
  });

  it('does not select inaccessible targets and shows a next action for pending access', async () => {
    fetchMock.mockResolvedValue(response([candidate({ inviteStatus: 'PENDING', canInvite: false })]));
    render(<InviteTargetPicker role="RECEPCAO" onTargetChange={onTargetChange} />);
    const input = screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    fireEvent.change(input, { target: { value: 'Ana' } });

    expect(await screen.findByText('Convite pendente. Consulte a aba Convites pendentes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Ana Professora/ }));
    expect(onTargetChange).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXISTING_RECORD' }), expect.anything());
  });

  it.each([
    [candidate({ accessStatus: 'ACTIVE', canInvite: false }), 'Acesso já ativo nesta escola. Gerencie o usuário na lista.'],
    [candidate({ accessStatus: 'SUSPENDED', canInvite: false }), 'A identidade está inativa. Reative o usuário antes de convidar.'],
  ] as const)('blocks unavailable access states and explains the next action', async (record, nextAction) => {
    fetchMock.mockResolvedValue(response([record]));
    render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' }), { target: { value: 'Ana' } });
    expect(await screen.findByText(nextAction)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Ana Professora/ }));
    expect(onTargetChange).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXISTING_RECORD' }), expect.anything());
  });

  it('offers explicit email fallback for collaborator invitations', async () => {
    render(<InviteTargetPicker role="FINANCEIRO" onTargetChange={onTargetChange} />);
    const manualFallback = screen.getByRole('button', { name: 'Não encontrou? Convidar por e-mail' });
    manualFallback.focus();
    fireEvent.keyDown(manualFallback, { key: 'Enter' });
    fireEvent.click(manualFallback); // Native button Enter activation.
    const emailInput = await screen.findByRole('textbox', { name: 'E-mail do convidado' });
    await waitFor(() => expect(document.activeElement).toBe(emailInput));
    fireEvent.change(emailInput, { target: { value: 'novo@example.test' } });
    expect(onTargetChange).toHaveBeenLastCalledWith({ kind: 'EMAIL', email: 'novo@example.test', role: 'FINANCEIRO' });

    const returnToSearch = screen.getByRole('button', { name: 'Buscar cadastro existente' });
    returnToSearch.focus();
    fireEvent.keyDown(returnToSearch, { key: 'Enter' });
    fireEvent.click(returnToSearch); // Native button Enter activation.
    const searchInput = await screen.findByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
  });

  it('announces loading, empty, and recoverable error states', async () => {
    let resolveFetch: ((_value: ReturnType<typeof response>) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' }), { target: { value: 'Sem resultado' } });
    expect(await screen.findByText('Buscando cadastros…')).toBeInTheDocument();
    resolveFetch?.(response([]));
    expect(await screen.findByText('Nenhum colaborador disponível para convite.')).toBeInTheDocument();

    cleanup();
    fetchMock.mockRejectedValueOnce(new Error('Falha transitória.')).mockResolvedValueOnce(response([]));
    render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' }), { target: { value: 'Ana' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha transitória.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nenhum colaborador disponível para convite.')).toBeInTheDocument();
  });

  it('shows scoped students and selects a responsible record without binding its stored email', async () => {
    const responsible = candidate({
      recordType: 'RESPONSAVEL', recordId: 'guardian-1', name: 'Responsável A', email: 'stored@example.test',
      students: [{ id: 'student-a', name: 'Aluno A' }],
    });
    fetchMock.mockResolvedValue(response([responsible]));
    render(<InviteTargetPicker role="RESPONSAVEL" onTargetChange={onTargetChange} />);
    const input = screen.getByRole('combobox', { name: 'Buscar responsável cadastrado' });
    fireEvent.change(input, { target: { value: 'Responsável' } });
    expect(await screen.findByRole('option', { name: /Responsável A/ })).toHaveTextContent('Alunos: Aluno A');
    fireEvent.click(await screen.findByRole('option', { name: /Responsável A/ }));

    expect(screen.getByText('Responsável A')).toBeInTheDocument();
    expect(screen.queryByText('stored@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('Aluno A')).not.toBeInTheDocument();
    expect(onTargetChange).toHaveBeenLastCalledWith({
      kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'guardian-1', role: 'RESPONSAVEL',
    }, expect.objectContaining({ students: [{ id: 'student-a', name: 'Aluno A' }] }));
  });

  it('paginates candidates and resets selected record when the role changes', async () => {
    fetchMock
      .mockResolvedValueOnce(response([candidate()], 1, 1, true))
      .mockResolvedValueOnce(response([candidate({ recordId: 'employee-2', name: 'Bia' })], 2, 1, false))
      .mockResolvedValue(response([candidate()]));
    const { rerender } = render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    const input = screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'A' } });
    await screen.findByRole('option', { name: /Ana Professora/ });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('option', { name: /Bia/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.any(Object));

    fireEvent.click(screen.getByRole('option', { name: /Ana Professora/ }));
    rerender(<InviteTargetPicker role="FINANCEIRO" onTargetChange={onTargetChange} />);
    await waitFor(() => expect(screen.queryByText('Ana Professora')).not.toBeInTheDocument());
    expect(onTargetChange).toHaveBeenLastCalledWith(null);
  });

  it('clears previous results immediately and ignores an older page response after a new query', async () => {
    let resolveStaleA: ((_value: ReturnType<typeof response>) => void) | undefined;
    const firstA = candidate({ recordId: 'a-first', name: 'A Primeira' });
    const staleA = candidate({ recordId: 'a-stale', name: 'A Atrasada' });
    const currentB = candidate({ recordId: 'b-current', name: 'B Atual' });
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const query = url.searchParams.get('q');
      const requestedPage = url.searchParams.get('page');
      if (query === 'A' && requestedPage === '1') return Promise.resolve(response([firstA], 1, 1, true));
      if (query === 'A') return new Promise((resolve) => { resolveStaleA = resolve; });
      if (query === 'B') return Promise.resolve(response([currentB], 1, 1, false));
      return Promise.resolve(response([]));
    });

    render(<InviteTargetPicker role="PROFESSOR" onTargetChange={onTargetChange} />);
    const input = screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'A' } });
    expect(await screen.findByRole('option', { name: /A Primeira/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(resolveStaleA).toBeDefined());

    fireEvent.change(input, { target: { value: 'B' } });
    expect(screen.queryByRole('option', { name: /A Primeira/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /A Atrasada/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /B Atual/ })).toBeInTheDocument();

    await act(async () => {
      resolveStaleA?.(response([staleA], 2, 1, false));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('option', { name: /B Atual/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /A Atrasada/ })).not.toBeInTheDocument();
  });
});
