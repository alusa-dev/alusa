'use client';

import { ColaboradoresFeature } from '@/features/cadastro/colaboradores/ColaboradoresFeature';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Trash2,
  Plus,
  Search,
  Filter,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit3,
  Eye,
  EyeOff,
} from '@/components/icons/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import ColaboradorWizardDialog from '@/components/colaboradores/ColaboradorWizardDialog';
import ColaboradorEditDialog from '@/components/colaboradores/ColaboradorEditDialog';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { useSession } from 'next-auth/react';

type Colaborador = {
  id: string;
  nome: string;
  email?: string;
  telefone1?: string;
  status: 'ATIVO' | 'INATIVO';
  foto?: string;
  cpf?: string;
  cargo: 'PROFESSOR' | 'RECEPCAO' | 'FINANCEIRO' | 'ADMINISTRATIVO' | 'OUTRO';
  especialidade?: string;
  dataAdmissao?: string;
  salario?: number;
};

function maskCpf(cpf: string) {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9, 11);
}

function formatCargo(cargo: string) {
  const map: Record<string, string> = {
    PROFESSOR: 'Professor',
    RECEPCAO: 'Recepção',
    FINANCEIRO: 'Financeiro',
    ADMINISTRATIVO: 'Administrativo',
    OUTRO: 'Outro',
  };
  return map[cargo] || cargo;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyColaboradoresPage() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  // Controle de privacidade: oculta dados sensíveis com blur
  const [hideSensitive, setHideSensitive] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  // Edição
  const [editOpen, setEditOpen] = useState(false);
  const [editColaborador, setEditColaborador] = useState<Colaborador | null>(null);
  // Exclusão
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteColaborador, setDeleteColaborador] = useState<Colaborador | null>(null);
  const [deleteMotivo, setDeleteMotivo] = useState('');
  // Ordenação
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'ATIVO' | 'INATIVO'>('TODOS');
  const { data: session } = useSession();
  const effectiveContaId =
    (session?.user as { contaId?: string } | undefined)?.contaId || 'conta-default';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/colaboradores?contaId=${effectiveContaId}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Falha ao carregar colaboradores');
      const data = await res.json();
      const items = (Array.isArray(data?.items) ? data.items : []).map((c: unknown) => {
        const col = c as Record<string, unknown>;
        const rawFotoCandidates = [col.foto, col['image'], col['avatar']];
        const rawFoto = rawFotoCandidates.find(
          (v): v is string => typeof v === 'string' && v.trim().length > 4,
        );
        const foto = rawFoto;
        return {
          id: String(col.id),
          nome: String(col.nome ?? ''),
          email: (typeof col.email === 'string' ? col.email : undefined) as string | undefined,
          telefone1: (typeof col.telefone1 === 'string' ? col.telefone1 : undefined) as
            | string
            | undefined,
          status: (col.status === 'INATIVO' ? 'INATIVO' : 'ATIVO') as 'ATIVO' | 'INATIVO',
          foto,
          cpf: (typeof col.cpf === 'string' ? col.cpf : undefined) as string | undefined,
          cargo: (typeof col.cargo === 'string' ? col.cargo : 'OUTRO') || 'OUTRO',
          especialidade: (typeof col.especialidade === 'string' ? col.especialidade : undefined) as
            | string
            | undefined,
          dataAdmissao: (typeof col.dataAdmissao === 'string' ? col.dataAdmissao : undefined) as
            | string
            | undefined,
          salario: typeof col.salario === 'number' ? Number(col.salario) : undefined,
        } as Colaborador;
      });
      setColaboradores(items);
    } catch {
      setColaboradores([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveContaId]);

  useEffect(() => {
    load();
  }, [load]);

  // Recarrega quando wizard dispara evento customizado
  useEffect(() => {
    function handleChanged() {
      load();
    }
    window.addEventListener('colaboradores:changed', handleChanged as EventListener);
    return () =>
      window.removeEventListener('colaboradores:changed', handleChanged as EventListener);
  }, [load]);

  const onCreated = () => {
    load();
  };

  // Resetar página quando filtros/ordenação mudarem
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, sortOrder]);

  // Filtrar colaboradores
  const filteredColaboradores = colaboradores.filter((colaborador) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const nome = colaborador.nome.toLowerCase();
      const email = (colaborador.email || '').toLowerCase();
      const cpf = (colaborador.cpf || '').replace(/\D/g, '');
      const termNumbers = searchTerm.replace(/\D/g, '');

      if (!nome.includes(term) && !email.includes(term) && !cpf.includes(termNumbers)) {
        return false;
      }
    }

    if (statusFilter !== 'TODOS' && colaborador.status !== statusFilter) {
      return false;
    }

    return true;
  });

  // Aplicar ordenação por nome conforme sortOrder
  const orderedColaboradores = [...filteredColaboradores].sort((a, b) => {
    const comp = a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
    return sortOrder === 'ASC' ? comp : -comp;
  });

  return (
    <div className="space-y-6">
      {/* Header + Subheader */}
      <div className="space-y-1">
        <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
          Gestão de Colaboradores
        </h1>
        <p className="text-[13px] text-gray-500">
          Gerencie cadastros, status e informações dos colaboradores.
        </p>
      </div>

      {/* Barra de ações */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Ações à esquerda */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setOpen(true)}
              className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
              aria-label="Cadastrar colaborador"
              data-testid="abrir-wizard-colaborador"
            >
              <Plus className="h-4 w-4 mr-2 transition-none" />
              Cadastrar colaborador
            </Button>
            <Button
              variant="outline"
              onClick={() => setHideSensitive((v) => !v)}
              className="h-10 px-4 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-none [&_svg]:transition-none"
              title={
                hideSensitive ? 'Mostrar CPF, e-mail e telefone' : 'Ocultar CPF, e-mail e telefone'
              }
              aria-label={hideSensitive ? 'Mostrar dados sensíveis' : 'Ocultar dados sensíveis'}
              aria-pressed={hideSensitive}
            >
              {hideSensitive ? (
                <>
                  <Eye className="h-4 w-4 mr-2 transition-none" />
                  Mostrar dados
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-2 transition-none" />
                  Ocultar dados
                </>
              )}
            </Button>
          </div>

          {/* Filtros à direita (sempre visíveis) */}
          <div className="flex w-full md:w-auto items-center gap-3">
            {/* Botão Filtro (à esquerda do status) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 px-4 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-none"
                >
                  <Filter className="h-4 w-4 mr-2 transition-none" />
                  Filtro
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Ordenar por nome
                </div>
                <DropdownMenuItem
                  onClick={() => setSortOrder('ASC')}
                  className={'justify-between ' + (sortOrder === 'ASC' ? 'text-brand-accent' : '')}
                >
                  A–Z (crescente)
                  {sortOrder === 'ASC' ? <CheckCircle className="h-4 w-4" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortOrder('DESC')}
                  className={'justify-between ' + (sortOrder === 'DESC' ? 'text-brand-accent' : '')}
                >
                  Z–A (decrescente)
                  {sortOrder === 'DESC' ? <CheckCircle className="h-4 w-4" /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
            >
              <SelectTrigger className="h-10 !w-auto md:!w-auto shrink-0 min-w-[140px] max-w-[170px] whitespace-nowrap bg-white text-gray-700 border border-gray-300 shadow-none px-3 flex items-center justify-between gap-2">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="TODOS">Todos os status</SelectItem>
                <SelectItem value="ATIVO">Ativo</SelectItem>
                <SelectItem value="INATIVO">Inativo</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative w-full md:flex-1 md:min-w-[250px] md:max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 transition-none" />
              <Input
                placeholder="Buscar por nome, email ou CPF..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 pl-10 border border-gray-300 shadow-none placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <>
            {/* Header da tabela (skeleton) */}
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4">
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-1 h-4" />
                <Skeleton className="col-span-1 h-4" />
                <Skeleton className="col-span-1 h-4" />
              </div>
            </div>
            {/* Linhas (skeleton) */}
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-3">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3 flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <div className="flex gap-2">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    </div>
                  </div>
                  <Skeleton className="col-span-2 h-4 w-28" />
                  <Skeleton className="col-span-2 h-4 w-56" />
                  <Skeleton className="col-span-2 h-4 w-32" />
                  <Skeleton className="col-span-1 h-4 w-20" />
                  <Skeleton className="col-span-1 h-6 w-12 rounded-full" />
                  <Skeleton className="col-span-1 h-8 w-8 rounded-md justify-self-end" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Cabeçalho da tabela */}
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-3">Colaborador</div>
                <div className="col-span-2 text-center">CPF</div>
                <div className="col-span-2 text-center">E-mail</div>
                <div className="col-span-2 text-center">Telefone</div>
                <div className="col-span-1 text-center">Função</div>
                <div className="col-span-1 text-center">Status</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            {/* Linhas */}
            <div className="divide-y">
              {orderedColaboradores.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhum colaborador encontrado
                </div>
              ) : (
                // Paginação client-side
                ((() => {
                  const totalPages = Math.max(1, Math.ceil(orderedColaboradores.length / pageSize));
                  if (page > totalPages) setPage(totalPages);
                })(),
                orderedColaboradores
                  .slice((page - 1) * pageSize, page * pageSize)
                  .map((colaborador) => {
                    const initials = colaborador.nome
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join('')
                      .toUpperCase();
                    const shouldBlur = (val: string | undefined) =>
                      hideSensitive && !!val && val !== '-';
                    const blurBox =
                      'inline-block filter blur-[3px] px-1 -mx-1 py-0.5 -my-0.5 leading-[20px]';

                    return (
                      <div
                        key={colaborador.id}
                        className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white"
                      >
                        <div className="grid grid-cols-12 gap-4 items-center">
                          {/* Colaborador */}
                          <div className="col-span-3 flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              {colaborador.foto ? (
                                <AvatarImage
                                  src={colaborador.foto}
                                  alt={colaborador.nome}
                                  draggable={false}
                                  onError={(e) => {
                                    const el = e.currentTarget as HTMLImageElement;
                                    el.style.display = 'none';
                                  }}
                                />
                              ) : null}
                              <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div
                                className="font-normal text-gray-900 text-[13px] truncate"
                                data-testid={`colaborador-nome-${colaborador.id}`}
                              >
                                {colaborador.nome}
                              </div>
                              {/* Chips abaixo do nome */}
                              <div className="flex flex-wrap gap-1 mt-1">
                                {colaborador.especialidade && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                                  >
                                    {colaborador.especialidade}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* CPF */}
                          <div className="col-span-2 text-[13px] text-gray-700 text-center">
                            <span
                              className={shouldBlur(colaborador.cpf) ? blurBox : 'leading-[20px]'}
                            >
                              {colaborador.cpf ? maskCpf(colaborador.cpf) : '-'}
                            </span>
                          </div>
                          {/* E-mail */}
                          <div
                            className="col-span-2 text-[13px] text-gray-700 text-center"
                            title={colaborador.email || ''}
                          >
                            {shouldBlur(colaborador.email) ? (
                              <span className={blurBox}>{colaborador.email || '-'}</span>
                            ) : (
                              <span className="inline-block max-w-full truncate leading-[20px]">
                                {colaborador.email || '-'}
                              </span>
                            )}
                          </div>
                          {/* Telefone */}
                          <div className="col-span-2 text-[13px] text-gray-700 text-center">
                            <span
                              className={
                                shouldBlur(colaborador.telefone1) ? blurBox : 'leading-[20px]'
                              }
                            >
                              {colaborador.telefone1 || '-'}
                            </span>
                          </div>
                          {/* Função */}
                          <div className="col-span-1 text-center">
                            <Badge
                              variant="outline"
                              className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                            >
                              {formatCargo(colaborador.cargo)}
                            </Badge>
                          </div>
                          {/* Status */}
                          <div className="col-span-1 flex justify-center">
                            <Badge status={colaborador.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'} />
                          </div>
                          {/* Ações */}
                          <div className="col-span-1 flex justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                              aria-label="Editar colaborador"
                              onClick={() => {
                                setEditColaborador(colaborador);
                                setEditOpen(true);
                              }}
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              aria-label="Excluir colaborador"
                              onClick={() => {
                                setDeleteColaborador(colaborador);
                                setDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }))
              )}
            </div>
          </>
        )}
      </div>

      {/* Paginação */}
      {orderedColaboradores.length > 0 && (
        <Pagination
          totalItems={orderedColaboradores.length}
          pageSize={pageSize}
          page={page}
          onChange={setPage}
        />
      )}

      {/* Modais */}
      <ColaboradorWizardDialog
        open={open}
        onOpenChange={setOpen}
        onFinish={onCreated}
        contaId={effectiveContaId}
      />
      <ColaboradorEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode={editColaborador ? 'edit' : 'create'}
        colaborador={editColaborador}
        contaId={effectiveContaId}
        onSaved={() => {
          setEditOpen(false);
          onCreated();
        }}
      />

      {/* Diálogo de confirmação de exclusão */}
      <ConfirmDeleteDialog
        open={deleteOpen}
        title="Excluir colaborador"
        description={(() => {
          if (!deleteColaborador) {
            return 'Tem certeza que deseja excluir este colaborador? Esta ação não pode ser desfeita.';
          }
          const parts = String(deleteColaborador.nome || '')
            .trim()
            .split(/\s+/);
          const first = parts[0];
          const last = parts.length > 1 ? parts[parts.length - 1] : '';
          const display =
            last && last.toLowerCase() !== first.toLowerCase() ? `${first} ${last}` : first;
          return (
            <span>
              Tem certeza que deseja excluir o colaborador <strong>{display}</strong>? Esta ação não
              pode ser desfeita.
            </span>
          );
        })()}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        loadingLabel="Excluindo..."
        onOpenChange={(o) => {
          if (!o) {
            setDeleteColaborador(null);
            setDeleteMotivo('');
          }
          setDeleteOpen(o);
        }}
        onConfirm={async () => {
          if (!deleteColaborador?.id) return;
          try {
            const res = await fetch(`/api/colaboradores/${deleteColaborador.id}`, {
              method: 'DELETE',
            });
            if (!res.ok) return;
            try {
              window.dispatchEvent(new CustomEvent('colaboradores:changed'));
            } catch {
              /* noop */
            }
            setDeleteOpen(false);
            setDeleteColaborador(null);
            setDeleteMotivo('');
            load();
          } catch {
            /* noop */
          }
        }}
      >
        <div className="space-y-3 text-left">
          <label
            htmlFor="motivo-colaborador"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Motivo (opcional)
          </label>
          <textarea
            id="motivo-colaborador"
            value={deleteMotivo}
            onChange={(e) => setDeleteMotivo(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-[#7A1BFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40"
            placeholder="Ex.: duplicado, teste..."
          />
          <p className="text-xs leading-4 text-slate-500">
            O motivo é opcional e ajuda o time a entender o contexto da exclusão.
          </p>
        </div>
      </ConfirmDeleteDialog>
    </div>
  );
}

void LegacyColaboradoresPage;

// Componente de paginação simples, centralizado com elipses
function Pagination({
  totalItems,
  pageSize,
  page,
  onChange,
}: {
  totalItems: number;
  pageSize: number;
  page: number;
  onChange: (_p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clamp = (n: number) => Math.min(totalPages, Math.max(1, n));

  const makePages = () => {
    const pages: (number | '…')[] = [];
    const maxButtons = 5; // 1, 2, current, last-1, last (com elipses)
    if (totalPages <= maxButtons + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    const siblings = 1;
    const left = Math.max(2, page - siblings);
    const right = Math.min(totalPages - 1, page + siblings);
    pages.push(1);
    if (left > 2) pages.push('…');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('…');
    pages.push(totalPages);
    return pages;
  };

  const pages = makePages();

  return (
    <div className="flex items-center justify-center py-6">
      <div className="flex items-center gap-2 text-sm">
        <IconButton aria-label="Primeira página" disabled={page === 1} onClick={() => onChange(1)}>
          <ChevronsLeft className="h-4 w-4" />
        </IconButton>
        <IconButton
          aria-label="Página anterior"
          disabled={page === 1}
          onClick={() => onChange(clamp(page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </IconButton>

        {pages.map((p, idx) =>
          p === '…' ? (
            <span key={`e-${idx}`} className="px-2 text-brand-accent/50">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={
                'h-8 w-8 rounded-md border transition grid place-items-center ' +
                'border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white ' +
                (p === page
                  ? 'bg-brand-accent text-white border-brand-accent hover:bg-brand-accent/90 hover:text-white'
                  : 'bg-white')
              }
            >
              {p}
            </button>
          ),
        )}

        <IconButton
          aria-label="Próxima página"
          disabled={page === totalPages}
          onClick={() => onChange(clamp(page + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <IconButton
          aria-label="Última página"
          disabled={page === totalPages}
          onClick={() => onChange(totalPages)}
        >
          <ChevronsRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 rounded-md border grid place-items-center transition \
      border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent \
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white \
      disabled:text-gray-300 disabled:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-300 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export default function ColaboradoresPage() {
  return <ColaboradoresFeature />;
}
