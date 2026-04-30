import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AlunoDetalhesFeature } from '@/features/cadastro/alunos/AlunoDetalhesFeature';
import { pushToast } from '@/components/ui/toast';

void React;

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  pushToast: vi.fn(),
}));

vi.mock('@/components/dialogs/ConfirmDeleteDialog', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/image/ImageCropDialog', () => ({
  ImageCropDialog: () => null,
}));

const baseAluno = {
  id: 'aluno-1',
  nome: 'Elaine Cristina dos Santos Costa',
  nomeSocial: null,
  dataNasc: '1995-12-30T00:00:00.000Z',
  cpf: '02719786276',
  email: 'balletelainecosta@gmail.com',
  telefone: '9798117409',
  foto: 'data:image/png;base64,ZmFrZQ==',
  status: 'ATIVO',
  enderecoCep: null,
  enderecoLogradouro: null,
  enderecoNumero: null,
  enderecoComplemento: null,
  enderecoBairro: null,
  enderecoCidade: null,
  enderecoUf: null,
  observacao: null,
  genero: null,
  modalidadePrincipal: null,
  nivel: null,
  alergias: null,
  restricoesMedicas: null,
  contatoEmergenciaNome: null,
  contatoEmergenciaTelefone: null,
  origemCadastro: null,
  bolsaDescontoPercent: null,
  isentoTaxaMatricula: false,
  consentimentoImagem: false,
  dataConsentimentoImagem: null,
  consentimentoComunicacoes: true,
  tamanhoCamiseta: null,
  tamanhoCalcado: null,
  codigoInterno: '00001',
  tags: [],
  asaasCustomerId: null,
  asaasCustomerExternalReference: null,
  dataInativacao: null,
  motivoInativacao: null,
  createdAt: null,
  updatedAt: null,
  responsaveis: [],
  responsavelPrincipal: null,
  matriculas: [],
  cobrancas: [],
  assinaturas: [],
  parcelamentos: [],
  notificacoes: {
    asaasCustomerId: null,
    preferences: [],
    customerChannelDefaults: [],
  },
  resumo: {
    matriculas: 0,
    matriculasAtivas: 0,
    cobrancas: 0,
    cobrancasPendentes: 0,
    assinaturas: 0,
    parcelamentos: 0,
  },
};

describe('AlunoDetalhesFeature', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renderiza a seção de foto e envia PATCH ao remover a foto do aluno', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ aluno: baseAluno }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ aluno: { ...baseAluno, foto: null } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ aluno: { ...baseAluno, foto: null } }),
      } as Response);

    global.fetch = fetchMock as typeof fetch;

    render(<AlunoDetalhesFeature alunoId="aluno-1" />);

    await screen.findByRole('heading', { name: 'Detalhes do aluno' });

    const photoTitle = await screen.findByText('Foto');
    const photoSection = photoTitle.closest('section');
    expect(photoSection).not.toBeNull();
    if (!photoSection) throw new Error('Seção de foto não encontrada');

    expect(within(photoSection).getByText(/A foto ajuda na identificação rápida do aluno/i)).toBeInTheDocument();

    fireEvent.click(within(photoSection).getByText('Remover'));
    fireEvent.click(within(photoSection).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchInit.method).toBe('PATCH');
    expect(JSON.parse(String(patchInit.body))).toEqual({ foto: null });

    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Foto atualizada',
          variant: 'success',
        }),
      );
    });

    expect(await screen.findByText('Enviar foto')).toBeInTheDocument();
  });
});