'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { createModalidade } from '@/features/cadastro/modalidades/services/modalidades-service';
import { createSala } from '@/features/cadastro/salas/services/salas-service';
import useCurrentUser from '@/hooks/use-current-user';

const DEBOUNCE_MS = 500;

const ModalidadeDialog = dynamic(
  () =>
    import('@/components/modalidades/ModalidadeDialog').then((m) => ({
      default: m.default,
    })),
  { ssr: false },
);

const SalaDialog = dynamic(
  () =>
    import('@/components/salas/SalaDialog').then((m) => ({
      default: m.default,
    })),
  { ssr: false },
);

/** Event listeners ficam síncronos; apenas os bundles dos diálogos são carregados sob demanda. */
export function GlobalQuickCreatePortals() {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const lastOpenModalidadeRef = useRef(0);
  const lastOpenSalaRef = useRef(0);

  const [openModalidade, setOpenModalidade] = useState(false);
  const [openSala, setOpenSala] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const resetModalidade = useCallback(() => {
    /* compatível com layout anterior */
  }, []);
  const resetSala = useCallback(() => {
    /* compatível com layout anterior */
  }, []);

  useEffect(() => {
    function handleOpenModalidade() {
      const now = Date.now();
      if (openModalidade || now - lastOpenModalidadeRef.current < DEBOUNCE_MS) return;
      lastOpenModalidadeRef.current = now;
      resetModalidade();
      setOpenModalidade(true);
    }
    function handleOpenSala() {
      const now = Date.now();
      if (openSala || now - lastOpenSalaRef.current < DEBOUNCE_MS) return;
      lastOpenSalaRef.current = now;
      resetSala();
      setOpenSala(true);
    }
    window.addEventListener('modalidade:dialog:new', handleOpenModalidade);
    window.addEventListener('sala:dialog:new', handleOpenSala);
    return () => {
      window.removeEventListener('modalidade:dialog:new', handleOpenModalidade);
      window.removeEventListener('sala:dialog:new', handleOpenSala);
    };
  }, [resetModalidade, resetSala, openModalidade, openSala]);

  async function handleCreateModalidadeDirect(vals: {
    nome: string;
    descricao: string;
    status: string;
  }) {
    if (!contaId) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Conta não encontrada"
          description="Não foi possível identificar a conta para salvar a modalidade."
          onClose={() => toast.dismiss(t)}
        />
      ));
      return;
    }
    if (submitting) return;
    try {
      setSubmitting(true);
      const created = await createModalidade({
        contaId,
        nome: vals.nome.trim(),
        descricao: vals.descricao.trim() || undefined,
        status: vals.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Modalidade criada"
          description="A modalidade foi cadastrada."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setOpenModalidade(false);
      window.dispatchEvent(new CustomEvent('modalidades:changed'));
      window.dispatchEvent(
        new CustomEvent('modalidade:created', { detail: { id: created.id, nome: created.nome } }),
      );
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao criar"
          description={(e as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSalaDirect(vals: {
    nome: string;
    descricao: string;
    capacidade: string;
    status: string;
  }) {
    if (!contaId) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Conta não encontrada"
          description="Não foi possível identificar a conta para salvar a sala."
          onClose={() => toast.dismiss(t)}
        />
      ));
      return;
    }
    if (submitting) return;
    try {
      setSubmitting(true);
      const created = await createSala({
        contaId,
        nome: vals.nome.trim(),
        descricao: vals.descricao.trim() || undefined,
        capacidade: Number(vals.capacidade) || 0,
        status: vals.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
      });
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Sala criada"
          description="A sala foi cadastrada."
          onClose={() => toast.dismiss(t)}
        />
      ));
      setOpenSala(false);
      window.dispatchEvent(new CustomEvent('salas:changed'));
      window.dispatchEvent(
        new CustomEvent('sala:created', { detail: { id: created.id, nome: created.nome } }),
      );
    } catch (e) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao criar"
          description={(e as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ModalidadeDialog
        open={openModalidade}
        creating
        modalidade={null}
        onOpenChange={(open) => {
          if (!open) setOpenModalidade(false);
        }}
        onSubmit={async (vals: { nome: string; descricao: string; status: string }) => {
          await handleCreateModalidadeDirect(vals);
        }}
      />
      <SalaDialog
        open={openSala}
        creating
        sala={null}
        onOpenChange={(open) => {
          if (!open) setOpenSala(false);
        }}
        onSubmit={async (vals) => {
          await handleCreateSalaDirect(vals);
        }}
      />
    </>
  );
}
