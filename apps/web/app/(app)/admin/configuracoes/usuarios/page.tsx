'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { Badge, type StatusType } from '@/components/ui/badge';
import { CustomToast } from '@/components/ui/toast';
import { Edit3, Trash2, Search } from '@/components/icons/icons';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import UsuarioEditDialog from '@/components/usuarios/UsuarioEditDialog';
import InviteLinkModal from '@/components/invite/InviteLinkModal';
import { buildInviteUrl } from '@alusa/lib/client';

type Role = 'PROFESSOR' | 'RECEPCAO' | 'FINANCEIRO' | 'RESPONSAVEL' | 'ADMIN';
type UserStatus = 'ATIVO' | 'INATIVO';
type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
type UserPermissions = {
  canEdit: boolean;
  canToggleStatus: boolean;
  canDelete: boolean;
};

type InviteRow = { id: string; email: string | null; role: Role; createdAt: string; status: InviteStatus };
type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdVia?: 'INVITE' | 'DIRECT';
  isCurrentUser: boolean;
  isOwner: boolean;
  permissions: UserPermissions;
};
type UsersListItem = UserRow;

export default function ConfigUsuariosPage() {
  // Toast
  const [toast, setToast] = useState<{
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'info' | 'warning';
  } | null>(null);

  // Form
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('RECEPCAO');
  const [submitting, setSubmitting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | undefined>(undefined);
  
  // Alunos (para RESPONSAVEL)
  const [selectedAlunos, setSelectedAlunos] = useState<string[]>([]);
  const [alunosList, setAlunosList] = useState<{id: string; nome: string; email: string | null; idade: number | null}[]>([]);
  const [loadingAlunos, setLoadingAlunos] = useState(false);
  const [searchAlunoTerm, setSearchAlunoTerm] = useState('');
  const [showAlunoDropdown, setShowAlunoDropdown] = useState(false);

  // Tabs & busca
  const [tab, setTab] = useState<'USERS' | 'PENDING'>('USERS');
  const [search, setSearch] = useState('');

  // Dados
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userCount, setUserCount] = useState<number | null>(null);

  // Dialogs
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserName, setDeleteUserName] = useState<string | undefined>();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState<string | undefined>();

  // Loaders
  const loadInvites = useCallback(async () => {
    const res = await fetch('/api/users/invite', { cache: 'no-store' });
    if (!res.ok) return;
    const data: { items?: InviteApi[] } = await res.json();
    const items = data.items ?? [];
    setInvites(
      items.map((it) => ({
        id: it.id,
        email: it.email ?? null,
        role: it.role,
        status: (it.status as InviteStatus) || 'PENDING',
        createdAt:
          typeof it.createdAt === 'string'
            ? it.createdAt
            : it.createdAt instanceof Date
              ? it.createdAt.toISOString()
              : 'created_at' in it && typeof (it as { created_at?: string }).created_at === 'string'
                ? (it as { created_at: string }).created_at
                : new Date().toISOString(),
      })),
    );
  }, []);

  const reloadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users/list', { cache: 'no-store' });
      if (!res.ok) {
        setUsers([]);
        setUserCount(0);
        return;
      }
      const data: { items?: UsersListItem[] } = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped: UserRow[] = items.map((u) => ({
        id: String(u.id),
        name: String(u.name ?? ''),
        email: String(u.email ?? ''),
        role: String(u.role ?? 'RESPONSAVEL') as Role,
        status: String(u.status ?? 'ATIVO') as UserStatus,
        createdVia: u.createdVia === 'INVITE' ? 'INVITE' : 'DIRECT',
        isCurrentUser: Boolean(u.isCurrentUser),
        isOwner: Boolean(u.isOwner),
        permissions: {
          canEdit: Boolean(u.permissions?.canEdit),
          canToggleStatus: Boolean(u.permissions?.canToggleStatus),
          canDelete: Boolean(u.permissions?.canDelete),
        },
      }));
      setUsers(mapped);
      setUserCount(mapped.length);
    } catch {
      setUsers([]);
      setUserCount(0);
    }
  }, []);

  useEffect(() => {
    void loadInvites();
    void reloadUsers();
  }, [loadInvites, reloadUsers]);
  
  // Carregar alunos quando selecionar RESPONSAVEL
  useEffect(() => {
    async function loadAlunos() {
      if (role !== 'RESPONSAVEL') {
        setAlunosList([]);
        setSelectedAlunos([]);
        setSearchAlunoTerm('');
        return;
      }
      
      setLoadingAlunos(true);
      try {
        const res = await fetch('/api/alunos/list-for-responsavel');
        if (res.ok) {
          const data = await res.json();
          setAlunosList(data.alunos || []);
        }
      } catch (error) {
        console.error('Erro ao carregar alunos:', error);
        setAlunosList([]);
      } finally {
        setLoadingAlunos(false);
      }
    }
    
    loadAlunos();
  }, [role]);

  // Filtrar alunos baseado na busca
  const filteredAlunos = React.useMemo(() => {
    const term = searchAlunoTerm.toLowerCase().trim();
    if (!term) return [];
    
    return alunosList.filter((aluno) => {
      const nome = aluno.nome.toLowerCase();
      const email = (aluno.email || '').toLowerCase();
      return nome.includes(term) || email.includes(term);
    });
  }, [searchAlunoTerm, alunosList]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('#search-alunos') && !target.closest('.aluno-dropdown')) {
        setShowAlunoDropdown(false);
      }
    }
    
    if (showAlunoDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAlunoDropdown]);

  // Actions
  async function onGenerateInvite() {
    // Validar se selecionou alunos quando for RESPONSAVEL
    if (role === 'RESPONSAVEL') {
      if (selectedAlunos.length === 0) {
        setToast({
          title: 'Selecione ao menos um aluno',
          description: 'É necessário vincular ao menos um aluno ao responsável.',
          variant: 'warning',
        });
        setTimeout(() => setToast(null), 3000);
        return;
      }
    } else {
      // Para outras roles, email é obrigatório
      if (!email) return;
    }
    
    setSubmitting(true);
    try {
      setInviteUrl(null);
      setLastInviteEmail(email || 'responsavel@convidado');
      setInviteOpen(true);
      
      // Enviar payload apropriado
      const payload =
        role === 'RESPONSAVEL'
          ? { role, alunosIds: selectedAlunos }
          : { role, email };
      
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Falha ao criar convite');
      }
      const json = await res.json();
      const base =
        (process.env.NEXT_PUBLIC_APP_URL as string | undefined) ?? window.location.origin;
      const token: string | undefined = json?.invite?.token || json?.token;
      const link: string | undefined =
        json?.invite?.inviteUrl || (token ? buildInviteUrl(base, token) : undefined);
      setInviteUrl(link ?? null);
      setToast({ title: 'Convite criado', description: link, variant: 'success' });
      setEmail('');
      setSelectedAlunos([]); // Limpar seleção
      setSearchAlunoTerm(''); // Limpar busca
      await loadInvites();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Tente novamente';
      setToast({ title: 'Erro ao enviar convite', description: msg, variant: 'error' });
      setInviteOpen(false);
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 3500);
    }
  }

  const onEditUser = useCallback(
    (id: string) => {
      const u = users.find((x) => x.id === id);
      setEditUserId(id);
      setEditUserName(u?.name || u?.email);
      setEditOpen(true);
    },
    [users],
  );

  const onDeleteUser = useCallback(
    (id: string) => {
      const toDelete = users.find((u) => u.id === id);
      setDeleteUserId(id);
      setDeleteUserName(toDelete?.name || toDelete?.email);
      setDeleteOpen(true);
    },
    [users],
  );

  async function handleConfirmDeleteUser() {
    if (!deleteUserId) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(deleteUserId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Falha ao excluir usuário');
      }
      setToast({
        title: 'Usuário excluído',
        description: deleteUserName ? `${deleteUserName} foi removido.` : undefined,
        variant: 'success',
      });
      await reloadUsers();
      setDeleteOpen(false);
    } catch (e) {
      setToast({
        title: 'Erro ao excluir usuário',
        description: e instanceof Error ? e.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setDeleteLoading(false);
      setTimeout(() => setToast(null), 3000);
      setDeleteUserId(null);
      setDeleteUserName(undefined);
    }
  }

  const onDeleteInvite = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/users/invite/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || 'Falha ao excluir convite');
      }
      await loadInvites();
      setToast({ title: 'Convite removido', variant: 'success' });
    } catch (error) {
      setToast({
        title: 'Erro ao excluir convite',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setTimeout(() => setToast(null), 2500);
    }
  }, [loadInvites]);

  const onToggleStatus = useCallback(async (u: UserRow) => {
    if (!u.permissions.canToggleStatus) return;
    try {
      const next = u.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
      const who = u.name || u.email;
      const activating = next === 'ATIVO';
      const res = await fetch(`/api/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Falha ao atualizar status');
      }
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: next } : x)));
      setToast({
        title: activating ? 'Usuário ativado' : 'Usuário marcado como inativo',
        description: activating
          ? `${who} agora pode acessar o sistema.`
          : `${who} não poderá acessar até ser reativado.`,
        variant: 'success',
      });
    } catch (e) {
      setToast({
        title: u.status === 'ATIVO' ? 'Falha ao inativar usuário' : 'Falha ao ativar usuário',
        description: e instanceof Error && e.message ? e.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setTimeout(() => setToast(null), 2500);
    }
  }, []);

  // Helpers
  function labelRole(role: Role): string {
    if (role === 'ADMIN') return 'Administrador';
    if (role === 'PROFESSOR') return 'Professor';
    if (role === 'RECEPCAO') return 'Recepção';
    if (role === 'FINANCEIRO') return 'Financeiro';
    if (role === 'RESPONSAVEL') return 'Responsável';
    return role;
  }

  // Tabela de usuários
  function renderUserTable() {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? users.filter(
          (u) =>
            u.name.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term) ||
            labelRole(u.role).toLowerCase().includes(term),
        )
      : users;

    return (
      <div className="overflow-auto rounded-lg border bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        {/* Cabeçalho sticky */}
        <div className="sticky top-0 z-10 border-b bg-gray-50 px-6 py-2 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            <div className="col-span-4 text-left">Nome</div>
            <div className="col-span-4 text-left">Email</div>
            <div className="col-span-2 text-left">Função</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1 text-center">Editar</div>
          </div>
        </div>

        {/* Linhas */}
        <div className="divide-y alusa-dark:divide-[color:var(--color-border-default)]">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhum usuário encontrado</div>
          ) : (
            filtered.map((u) => (
              <div key={u.id} className="px-6 py-3 transition-colors duration-150 hover:bg-gray-50 alusa-dark:hover:bg-[color:rgba(255,255,255,0.04)]">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 text-sm text-gray-900 truncate flex items-center gap-2 alusa-dark:text-[color:var(--color-text-primary)]">
                    <span className="truncate">{u.name}</span>
                    {u.isCurrentUser && (
                      <Badge
                        variant="default"
                        size="sm"
                        aria-label="Você"
                        title="Você"
                      >
                        Você
                      </Badge>
                    )}
                    {u.isOwner && (
                      <Badge variant="neutral" size="sm">
                        Owner
                      </Badge>
                    )}
                    {u.createdVia === 'INVITE' && (
                      <Badge variant="info" size="sm">
                        Via convite
                      </Badge>
                    )}
                  </div>

                  <div
                    className="col-span-4 text-sm text-gray-700 text-left truncate alusa-dark:text-[color:var(--color-text-secondary)]"
                    title={u.email}
                  >
                    {u.email}
                  </div>

                  {/* Função como Badge */}
                  <div className="col-span-2 text-sm">
                    <Badge status={u.role as StatusType} size="sm" />
                  </div>

                  {/* Toggle de status — OFF cinza */}
                  <div className="col-span-1 flex justify-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={u.status === 'ATIVO'}
                      aria-label={`Alternar status de ${u.name || u.email}`}
                      disabled={!u.permissions.canToggleStatus}
                      onClick={() => onToggleStatus(u)}
                      onKeyDown={(e) => {
                        if ((e.key === ' ' || e.key === 'Enter') && u.permissions.canToggleStatus) {
                          e.preventDefault();
                          onToggleStatus(u);
                        }
                      }}
                      className={[
                        'relative inline-flex h-6 w-11 items-center rounded-full p-[2px]',
                        'transition-colors duration-200 ease-out focus:outline-none focus:ring-0 focus-visible:ring-0',
                        !u.permissions.canToggleStatus
                          ? 'bg-gray-300 cursor-not-allowed alusa-dark:bg-[color:var(--color-bg-elevated)]'
                          : u.status === 'ATIVO'
                            ? 'bg-green-500 cursor-pointer'
                            : 'bg-gray-300 cursor-pointer alusa-dark:bg-[color:var(--color-bg-elevated)]',
                      ].join(' ')}
                    >
                      <span className="sr-only">{u.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</span>
                      <span
                        aria-hidden
                        className={[
                          'absolute left-[2px] top-1/2 -translate-y-1/2 h-[20px] w-[20px] rounded-full bg-white',
                          'shadow-sm ring-1 ring-black/5',
                          'transition-transform duration-200 ease-out will-change-transform',
                          u.status === 'ATIVO' ? 'translate-x-[20px]' : 'translate-x-0',
                        ].join(' ')}
                      />
                    </button>
                  </div>

                  {/* Ações sempre visíveis */}
                  <div className="col-span-1 flex justify-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50 alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] alusa-dark:hover:text-[color:var(--color-text-primary)] ${!u.permissions.canEdit ? 'opacity-40 pointer-events-none' : ''}`}
                      aria-label="Editar usuário"
                      onClick={() => onEditUser(u.id)}
                      disabled={!u.permissions.canEdit}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 alusa-dark:text-red-300 alusa-dark:hover:bg-red-500/10 alusa-dark:hover:text-red-200 ${!u.permissions.canDelete ? 'opacity-40 pointer-events-none' : ''}`}
                      aria-label="Excluir usuário"
                      onClick={() => onDeleteUser(u.id)}
                      disabled={!u.permissions.canDelete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Tabela de convites
  function renderInviteTable() {
    const formatDateTime = (iso: string) => {
      const d = new Date(iso);
      return isNaN(d.getTime())
        ? iso
        : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    };
    const statusBadge = (s: InviteStatus) => {
      const statusMap: Record<InviteStatus, StatusType> = {
        PENDING: 'PENDING_INVITE',
        ACCEPTED: 'ACCEPTED',
        REVOKED: 'REVOKED',
        EXPIRED: 'EXPIRED',
      };
      return <Badge status={statusMap[s]} size="sm" />;
    };
    const term = search.trim().toLowerCase();
    const filtered = term
      ? invites.filter(
          (i) =>
            (i.email ?? '').toLowerCase().includes(term) ||
            labelRole(i.role).toLowerCase().includes(term) ||
            String(i.status).toLowerCase().includes(term),
        )
      : invites;

    return (
      <div className="overflow-auto rounded-lg border bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <div className="sticky top-0 z-10 border-b bg-gray-50 px-6 py-2 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            <div className="col-span-4 text-left">Email</div>
            <div className="col-span-2 text-left">Função</div>
            <div className="col-span-3 text-left">Data de envio</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-1 text-center">Excluir</div>
          </div>
        </div>
        <div className="divide-y alusa-dark:divide-[color:var(--color-border-default)]">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhum convite pendente</div>
          ) : (
            filtered.map((i) => (
              <div key={i.id} className="px-6 py-3 transition-colors duration-150 hover:bg-gray-50 alusa-dark:hover:bg-[color:rgba(255,255,255,0.04)]">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 text-sm text-gray-900 truncate alusa-dark:text-[color:var(--color-text-primary)]" title={i.email ?? 'Definido no cadastro'}>
                    {i.email ?? 'Definido no cadastro'}
                  </div>
                  <div className="col-span-2 text-sm">
                    <Badge variant="neutral" size="sm">
                      {labelRole(i.role)}
                    </Badge>
                  </div>
                  <div className="col-span-3 text-sm text-gray-700 text-left alusa-dark:text-[color:var(--color-text-secondary)]">
                    {formatDateTime(i.createdAt)}
                  </div>
                  <div className="col-span-2 flex justify-center">{statusBadge(i.status)}</div>
                  <div className="col-span-1 flex justify-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 alusa-dark:text-red-300 alusa-dark:hover:bg-red-500/10 alusa-dark:hover:text-red-200"
                      aria-label="Excluir convite"
                      onClick={() => onDeleteInvite(i.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Render
  return (
    <div className="rounded-lg bg-white p-6 alusa-dark:bg-[color:var(--color-bg-card)]">
      <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
        Usuários e Convites
      </h2>
      <p className="mt-1 text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Gerencie convites e usuários do sistema.</p>

      {/* Card: Enviar convite */}
      <section className="mt-4 rounded-md border border-gray-200 p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]" aria-label="Enviar convite">
        <div className="grid grid-cols-12 gap-3 items-end">
          {/* Campo adaptável: Email ou Autocomplete de Alunos */}
          <div className="col-span-12 md:col-span-5">
            <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              {role === 'RESPONSAVEL' ? 'Pesquise e selecione os alunos *' : 'E-mail'}
            </label>
            
            {role === 'RESPONSAVEL' ? (
              // Input com tags inline para RESPONSAVEL
              <div className="relative mt-1">
                <div className="flex flex-wrap items-center gap-1.5 min-h-[40px] w-full rounded-md border border-gray-300 px-2 py-1.5 focus-within:border-gray-300 focus-within:ring-0 alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:focus-within:border-[color:var(--color-input-border)]">
                  {/* Tags dos alunos selecionados */}
                  {selectedAlunos.map((alunoId) => {
                    const aluno = alunosList.find(a => a.id === alunoId);
                    if (!aluno) return null;
                    return (
                      <span
                        key={alunoId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-xs font-medium alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-brand)]"
                      >
                        {aluno.nome}
                        <button
                          type="button"
                          onClick={() => setSelectedAlunos(selectedAlunos.filter(id => id !== alunoId))}
                          className="hover:bg-violet-200 rounded-full p-0.5 transition-colors alusa-dark:hover:bg-[color:rgba(169,77,255,0.24)]"
                          aria-label={`Remover ${aluno.nome}`}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                  
                  {/* Input de busca */}
                  <input
                    id="search-alunos"
                    type="text"
                    placeholder={loadingAlunos ? "Carregando..." : selectedAlunos.length === 0 ? "Pesquise o aluno..." : "Adicionar mais..."}
                    disabled={loadingAlunos}
                    className="flex-1 min-w-[120px] outline-none text-sm py-1 disabled:bg-gray-50 disabled:cursor-not-allowed alusa-dark:bg-transparent alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:disabled:bg-transparent"
                    value={searchAlunoTerm}
                    onChange={(e) => setSearchAlunoTerm(e.target.value)}
                    onFocus={() => setShowAlunoDropdown(true)}
                  />
                </div>
                
                {/* Dropdown de sugestões */}
                {showAlunoDropdown && searchAlunoTerm.trim().length > 0 && (
                  <div className="aluno-dropdown absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-popover)]">
                    {filteredAlunos.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500 text-center alusa-dark:text-[color:var(--color-text-muted)]">
                        Nenhum aluno encontrado
                      </div>
                    ) : (
                      filteredAlunos.map((aluno) => {
                        const isSelected = selectedAlunos.includes(aluno.id);
                        return (
                          <button
                            key={aluno.id}
                            type="button"
                            onClick={() => {
                              if (!isSelected) {
                                setSelectedAlunos([...selectedAlunos, aluno.id]);
                              }
                              setSearchAlunoTerm('');
                            }}
                            disabled={isSelected}
                            className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] ${
                              isSelected ? 'bg-gray-50 alusa-dark:bg-[color:var(--color-bg-card-soft)]' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{aluno.nome}</p>
                                {aluno.email && (
                                  <p className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">{aluno.email}</p>
                                )}
                                {aluno.idade && (
                                  <p className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">{aluno.idade} anos</p>
                                )}
                              </div>
                              {isSelected && (
                                <span className="text-xs text-violet-600 font-medium">✓</span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                
                {/* Helper text */}
                {!loadingAlunos && alunosList.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1 alusa-dark:text-[color:var(--color-text-muted)]">
                    Nenhum aluno disponível. Cadastre alunos primeiro.
                  </p>
                )}
              </div>
            ) : (
              // Input de email normal
              <input
                id="invite-email"
                aria-label="E-mail do convidado"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 h-10 text-sm outline-none focus:border-violet-400 alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]"
              />
            )}
          </div>
          
          <div className="col-span-12 md:col-span-3">
            <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              Função
            </label>
            <Select value={role} onValueChange={(v: Role) => setRole(v)}>
              <SelectTrigger
                aria-label="Função do convidado"
                id="invite-role"
                className="mt-1 h-10"
              >
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              {/* Popover com largura do trigger */}
              <SelectContent className="w-[var(--radix-select-trigger-width)]">
                <SelectItem value="PROFESSOR">Professor</SelectItem>
                <SelectItem value="RECEPCAO">Recepção</SelectItem>
                <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                <SelectItem value="RESPONSAVEL">Responsável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="col-span-12 md:col-span-4">
            <Button
              onClick={onGenerateInvite}
              disabled={submitting || (role !== 'RESPONSAVEL' && !email) || (role === 'RESPONSAVEL' && selectedAlunos.length === 0)}
              className="mt-6 md:mt-0 w-full h-10 rounded-md bg-violet-600 hover:bg-violet-700 text-white"
              aria-label="Gerar convite"
            >
              {submitting ? 'Gerando…' : 'Gerar convite'}
            </Button>
          </div>
        </div>
      </section>

      {/* Abas + busca */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as 'USERS' | 'PENDING')}
          >
            <TabsList
              aria-label="Alternar listagens"
              className="h-10 rounded-xl bg-slate-100/80 p-1 alusa-dark:bg-[color:var(--color-bg-card-soft)]"
            >
              <TabsTrigger value="USERS" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none data-[state=active]:bg-white data-[state=active]:text-gray-900 alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:data-[state=active]:bg-[color:var(--color-bg-elevated)] alusa-dark:data-[state=active]:text-[color:var(--color-text-primary)]">
                Usuários
              </TabsTrigger>
              <TabsTrigger value="PENDING" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none data-[state=active]:bg-white data-[state=active]:text-gray-900 alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:data-[state=active]:bg-[color:var(--color-bg-elevated)] alusa-dark:data-[state=active]:text-[color:var(--color-text-primary)]">
                Pendentes
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Busca sem sombra, dimensões coerentes e alinhada */}
          <div className="relative w-full md:w-[320px] max-w-sm">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 alusa-dark:text-[color:var(--color-text-muted)]"
              aria-hidden="true"
            />
            <Input
              className="h-10 pl-8 rounded-md border border-gray-300 shadow-none focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus-visible:ring-offset-0 focus:border-violet-400 alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]"
              placeholder={
                tab === 'USERS'
                  ? 'Buscar por nome, email ou função...'
                  : 'Buscar por email, função ou status...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          {typeof userCount === 'number' && (
            <div className="mb-2 text-[12px] text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              Total de usuários cadastrados:{' '}
              <span className="font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">{userCount}</span>
            </div>
          )}
          {tab === 'USERS' ? renderUserTable() : renderInviteTable()}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed right-6 top-6 z-[100]" role="status" aria-live="polite">
          <CustomToast
            title={toast.title}
            description={toast.description}
            variant={toast.variant}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      {/* Modais */}
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) {
            setDeleteUserId(null);
            setDeleteUserName(undefined);
          }
        }}
        title="Excluir usuário"
        description={(() => {
          if (!deleteUserName) {
            return 'Tem certeza que deseja remover permanentemente o acesso deste usuário? Auditorias e logs serão preservados.';
          }
          const parts = deleteUserName.trim().split(/\s+/);
          const first = parts[0];
          const last = parts.length > 1 ? parts[parts.length - 1] : '';
          const display =
            last && last.toLowerCase() !== first.toLowerCase() ? `${first} ${last}` : first;
          return (
            <span>
              Tem certeza que deseja remover permanentemente o acesso do usuário <strong>{display}</strong>? Auditorias e logs do que ele já fez na plataforma serão preservados.
            </span>
          );
        })()}
        confirmLabel={deleteLoading ? 'Excluindo…' : 'Excluir'}
        onConfirm={handleConfirmDeleteUser}
      />
      <UsuarioEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        usuarioId={editUserId}
        usuarioNome={editUserName}
        onSaved={reloadUsers}
      />

      {/* Modal de link do convite */}
      <InviteLinkModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        inviteUrl={inviteUrl}
        email={lastInviteEmail}
        expiresInHours={72}
      />
    </div>
  );
}

type InviteApi = {
  id: string;
  email: string | null;
  role: Role;
  status?: InviteStatus | string;
  createdAt?: string | Date;
  created_at?: string;
};
