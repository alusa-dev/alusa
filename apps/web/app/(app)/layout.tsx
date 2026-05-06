'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
// Constante de debounce pode ficar em nível de módulo (não é hook)
const DEBOUNCE_MS = 500;
import { useSession } from 'next-auth/react';
import { useUserStore } from '@/lib/stores/user-store';
import { Sidebar } from '@/components/layout/Sidebar';
import CardHeader from '@/components/layout/CardHeader';
import useCurrentUser from '@/hooks/use-current-user';
import ModalidadeDialog from '@/components/modalidades/ModalidadeDialog';
import SalaDialog from '@/components/salas/SalaDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { createModalidade } from '@/features/cadastro/modalidades/services/modalidades-service';
import { createSala } from '@/features/cadastro/salas/services/salas-service';

/** Espaçamentos já validados por você */
const CONTENT_GAP_PX = 12;
const OUTER_PADDING_TOP_PX = 20;
const OUTER_PADDING_RIGHT_PX = 24; // igual ao padding inferior
const OUTER_PADDING_BOTTOM_PX = 24;
const OUTER_PADDING_LEFT_PX = 12; // espaço para sombra do card não ser cortada
const CARD_PADDING_PX = 32;
const CARD_RADIUS_PX = 40;
const CARD_SHADOW =
  'rgba(14, 63, 126, 0.06) 0px 0px 0px 1px, rgba(42, 51, 70, 0.03) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 2px 2px -1px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.03) 0px 5px 5px -2.5px, rgba(42, 51, 70, 0.03) 0px 10px 10px -5px, rgba(42, 51, 70, 0.03) 0px 24px 24px -8px';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  // Hidrata a store central de usuário sempre que a sessão muda (garante persistência do avatar no header)
  // Obter função diretamente via getState evita problemas de tipagem durante CI/sem node_modules
  const setUser = useUserStore.getState().setUser;
  useEffect(() => {
    setUser(session?.user ?? null);
  }, [session, setUser]);

  // Health ping em dev
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      const w = window as unknown as { __alusaHealthCalled?: boolean };
      if (!w.__alusaHealthCalled) {
        w.__alusaHealthCalled = true;
        fetch('/api/health', { cache: 'no-store' }).catch(() => {});
      }
    }
  }, []);

  // largura inicial da sidebar
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (!root.style.getPropertyValue('--sidebar-w')) {
        root.style.setProperty('--sidebar-w', '262px');
      }

      root.style.setProperty('--app-toast-right-offset', `${OUTER_PADDING_RIGHT_PX + CARD_PADDING_PX}px`);
    }
  }, []);

  // Regra solicitada: Sidebar SEMPRE exibida nas páginas dentro de (app)
  // (Mantemos session effect/health ping para consistência.)

  return (
    <div className="relative h-screen w-full app-surface-bg overflow-hidden">
      <Sidebar />

      <main
        className="with-sidebar h-full overflow-hidden transition-[padding-left] duration-300 ease-in-out"
        style={{ ['--sidebar-gap' as string]: `${CONTENT_GAP_PX}px` } as Record<string, string>}
      >
        <div
          style={{
            paddingTop: OUTER_PADDING_TOP_PX,
            paddingRight: OUTER_PADDING_RIGHT_PX,
            paddingBottom: OUTER_PADDING_BOTTOM_PX,
            paddingLeft: OUTER_PADDING_LEFT_PX,
          }}
          className="h-full overflow-visible"
        >
          <div
            data-app-shell-card
            className="flex h-full w-full flex-col overflow-hidden transition-[width] duration-300 ease-in-out"
            style={{
              height: `calc(100vh - ${OUTER_PADDING_TOP_PX + OUTER_PADDING_BOTTOM_PX}px)`,
              background: '#FFFFFF',
              borderRadius: CARD_RADIUS_PX,
              padding: CARD_PADDING_PX,
              boxShadow: CARD_SHADOW,
              ['--app-shell-card-shadow' as string]: CARD_SHADOW,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <CardHeader />
            {/* Wrapper para o conteúdo das páginas. Removido CustomScrollArea para evitar scroll duplo no Editor.
                Páginas que precisam de scroll devem gerenciar seu próprio overflow (ex: DataTables, Dashboards).
             */}
            <div
              className="mt-6 flex-1 min-h-0 app-content-scroll relative"
              style={{ paddingRight: OUTER_PADDING_RIGHT_PX }}
            >
              {children}
            </div>
            <GlobalQuickCreatePortals />
          </div>
        </div>
      </main>
    </div>
  );
}

// Portal global para tratar eventos de criação disparados em selects (ex.: TurmaDialog)
function GlobalQuickCreatePortals() {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  // Refs de controle de debounce DEVEM estar dentro do componente (hooks não podem ser usados no módulo)
  const lastOpenModalidadeRef = useRef(0);
  const lastOpenSalaRef = useRef(0);

  const [openModalidade, setOpenModalidade] = useState(false);
  const [openSala, setOpenSala] = useState(false);

  // Estados de formulário simplificados
  const [submitting, setSubmitting] = useState(false);

  const resetModalidade = useCallback(() => {
    /* estados removidos - função mantida para compatibilidade futura */
  }, []);
  const resetSala = useCallback(() => {
    /* estados removidos - função mantida para compatibilidade futura */
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

  // Reaproveita componentes existentes para consistência visual
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
