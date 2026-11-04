/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteCandidateDTO } from '@/features/users/dtos';

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));
vi.mock('@/components/dialogs/ActionConfirmationDialog', () => ({ default: () => null }));
vi.mock('@/features/users/components/UserEditDialog', () => ({ default: () => null }));
vi.mock('@/features/users/components/invite/InviteLinkModal', () => ({ default: () => null }));

import ConfigUsuariosPage from '@/app/(app)/admin/settings/users/page';

function response(items: InviteCandidateDTO[]) {
  return { ok: true, json: async () => ({ items, page: 1, limit: 20, hasMore: false }) };
}

describe('admin users invitation picker integration', () => {
  const fetchMock = vi.fn();
  const candidate: InviteCandidateDTO = {
    kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-a', name: 'Ana Professora',
    email: 'ana@example.test', students: [], accessStatus: 'NONE', inviteStatus: 'NONE', canInvite: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({ data: { user: { role: 'ADMIN' } } });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/users/invite/candidates?')) return response([candidate]);
      if (url === '/api/users/invite' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ invite: { inviteUrl: 'https://app.test/invite?token=x' }, emailDelivery: 'sent' }) };
      }
      if (url === '/api/users/invite') return { ok: true, json: async () => ({ items: [] }) };
      if (url === '/api/users/list') return { ok: true, json: async () => ({ items: [] }) };
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('posts the selected existing collaborator as recordId plus current role', async () => {
    render(<ConfigUsuariosPage />);
    const input = screen.getByRole('combobox', { name: 'Buscar cadastro de colaborador' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByRole('option', { name: /Ana Professora/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users/invite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: 'employee-a', role: 'RECEPCAO',
      } }),
    })));
    expect(screen.getByRole('button', { name: 'Gerar convite' })).toBeDisabled();
  });

  it('posts responsible recordId and never sends its stored email as recipient', async () => {
    useSessionMock.mockReturnValue({ data: { user: { role: 'RECEPCAO' } } });
    const responsible: InviteCandidateDTO = {
      kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'guardian-a', name: 'Responsável A',
      email: 'stored@example.test', students: [{ id: 'student-a', name: 'Aluno A' }],
      accessStatus: 'NONE', inviteStatus: 'NONE', canInvite: true,
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/users/invite/candidates?')) return response([responsible]);
      if (url === '/api/users/invite' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ invite: { inviteUrl: 'https://app.test/invite?token=y' }, emailDelivery: 'not_applicable' }) };
      }
      if (url === '/api/users/invite') return { ok: true, json: async () => ({ items: [] }) };
      if (url === '/api/users/list') return { ok: true, json: async () => ({ items: [] }) };
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ConfigUsuariosPage />);
    const input = await screen.findByRole('combobox', { name: 'Buscar responsável cadastrado' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Responsável' } });
    fireEvent.click(await screen.findByRole('option', { name: /Responsável A/ }));
    expect(screen.getByText('Contato cadastrado (não usado para envio): stored@example.test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users/invite', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target: {
        kind: 'EXISTING_RECORD', recordType: 'RESPONSAVEL', recordId: 'guardian-a', role: 'RESPONSAVEL',
      } }),
    })));
  });
});
