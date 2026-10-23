'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, MoreVertical, Plus, Trash2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { toast } from '@/components/ui/toast';
import type { SchoolEventDTO } from '../../events-service';

type ScannerAccess = {
  id: string;
  operatorName: string;
  gateName: string;
  createdAt: string;
  createdByName: string;
  status: 'ACTIVE' | 'CLOSED';
};
type ApiResponse<T> = { data: T };

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? 'Não foi possível concluir a operação.');
  }
  return (json as ApiResponse<T>).data;
}

function absoluteScannerLink(token: string) {
  return new URL(`/ticket-check-in/${encodeURIComponent(token)}`, window.location.origin).toString();
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function EventTicketScannerAccesses({ event }: { event: SchoolEventDTO }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [operatorName, setOperatorName] = useState('');
  const [gateName, setGateName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ScannerAccess | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const queryKey = useMemo(() => ['events', event.id, 'ticket-scanner-accesses'], [event.id]);
  const accessesQuery = useQuery({
    queryKey,
    queryFn: async () => parseResponse<{ items: ScannerAccess[] }>(await fetch(`/api/events/${event.id}/ticket-scanner-accesses`, { cache: 'no-store' })),
  });

  const createMutation = useMutation({
    mutationFn: async () => parseResponse<ScannerAccess & { token: string }>(await fetch(`/api/events/${event.id}/ticket-scanner-accesses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName, gateName }),
    })),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey });
      setDialogOpen(false);
      setOperatorName('');
      setGateName('');
      try {
        await navigator.clipboard.writeText(absoluteScannerLink(created.token));
        toast.success({ title: 'Acesso criado e link copiado', description: `Link criado para ${created.operatorName}, ${created.gateName}.` });
      } catch {
        toast.error({ title: 'Acesso criado, mas o link não foi copiado', description: 'Use o menu do acesso para tentar copiar novamente.' });
      }
    },
    onError: (error) => toast.error({ title: 'Não foi possível criar o acesso', description: (error as Error).message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (access: ScannerAccess) => parseResponse<{ success: true }>(await fetch(`/api/events/${event.id}/ticket-scanner-accesses/${access.id}`, { method: 'DELETE' })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setDeleteTarget(null);
      toast.success({ title: 'Acesso excluído', description: 'O link foi revogado. Os registros de check-in foram preservados.' });
    },
    onError: (error) => toast.error({ title: 'Não foi possível excluir o acesso', description: (error as Error).message }),
  });

  const copyAccessLink = async (access: ScannerAccess) => {
    setCopyingId(access.id);
    try {
      const result = await parseResponse<{ token: string }>(await fetch(`/api/events/${event.id}/ticket-scanner-accesses/${access.id}/link`, { method: 'POST' }));
      await navigator.clipboard.writeText(absoluteScannerLink(result.token));
      toast.success({ title: 'Link do leitor copiado', description: `Link de ${access.operatorName} · ${access.gateName}.` });
    } catch (error) {
      toast.error({ title: 'Não foi possível copiar o link', description: error instanceof Error ? error.message : 'Verifique a permissão de área de transferência do navegador.' });
    } finally { setCopyingId(null); }
  };

  const items = accessesQuery.data?.items ?? [];

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Acessos do leitor</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Crie links individuais para operadores de check-in. Cada link permite validar e confirmar entradas somente neste evento.</p>
          </div>
          <Button type="button" className="h-10 shrink-0 bg-violet-700 text-white hover:bg-violet-800" disabled={['FINISHED', 'CANCELLED', 'ARCHIVED'].includes(event.status)} onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />Gerar link
          </Button>
        </div>

        {accessesQuery.isLoading ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" />Carregando acessos…</div>
        ) : accessesQuery.isError ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>Não foi possível carregar os acessos.</span><Button variant="outline" size="sm" onClick={() => void accessesQuery.refetch()}>Tentar novamente</Button></div>
        ) : items.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Nenhum acesso criado. Gere um link para cada operador e portaria.</p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-medium">Operador</th><th className="px-4 py-3 font-medium">Portaria</th><th className="px-4 py-3 font-medium">Criado por</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Criado em</th><th className="w-12 px-3 py-3"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((access) => (
                  <tr key={access.id} className="text-slate-700">
                    <td className="px-4 py-3 font-medium text-slate-900">{access.operatorName}</td>
                    <td className="px-4 py-3">{access.gateName}</td>
                    <td className="px-4 py-3">{access.createdByName}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${access.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{access.status === 'ACTIVE' ? 'Ativo' : 'Evento encerrado'}</span></td>
                    <td className="px-4 py-3 text-slate-500">{formatCreatedAt(access.createdAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`Ações de ${access.operatorName}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={copyingId === access.id || access.status !== 'ACTIVE'} onSelect={() => void copyAccessLink(access)}><Copy className="mr-2 h-4 w-4" />{copyingId === access.id ? 'Copiando…' : 'Copiar link'}</DropdownMenuItem>
                          <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onSelect={() => setDeleteTarget(access)}><Trash2 className="mr-2 h-4 w-4" />Excluir acesso</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent fullScreenMobile disableBackdropBlur disableScaleAnimation className="flex w-full max-w-lg flex-col gap-0 overflow-hidden rounded-[20px] border-slate-200 bg-white p-0 shadow-lg sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0">
          <DialogHeader className="shrink-0 bg-white pb-5 pl-8 pr-10 pt-8 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
            <DialogTitle className="text-xl font-normal tracking-tight text-[#0f0f0f]">Gerar acesso do leitor</DialogTitle>
            <DialogDescription className="mt-1 max-w-lg text-sm leading-relaxed text-[#5c5c5c]">Informe quem vai operar o check-in e a portaria. A pessoa poderá abrir o link sem conta ou login.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col bg-white" onSubmit={(formEvent) => { formEvent.preventDefault(); createMutation.mutate(); }}>
            <div className="flex-1 space-y-6 overflow-y-auto bg-white px-8 pb-6 pt-3 max-md:p-4">
              <div className="space-y-1.5"><Label htmlFor="scanner-operator-name">Nome do operador</Label><Input id="scanner-operator-name" autoFocus required minLength={2} maxLength={120} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="Nome da pessoa" className={wizardFieldInputClass} /></div>
              <div className="space-y-1.5"><Label htmlFor="scanner-gate-name">Portaria</Label><Input id="scanner-gate-name" required minLength={2} maxLength={120} value={gateName} onChange={(e) => setGateName(e.target.value)} placeholder="Ex.: Portaria principal" className={wizardFieldInputClass} /></div>
            </div>
            <DialogFooter className="flex shrink-0 flex-col-reverse items-stretch gap-2 bg-white pb-8 pl-8 pr-8 pt-4 max-md:flex-col-reverse max-md:p-4 md:flex-row md:items-center md:justify-end md:gap-3 sm:space-x-0">
              <Button type="button" className="h-10 min-h-10 rounded-[10px] border-0 bg-[#eff3f8] px-5 font-normal text-[#303030] shadow-none hover:bg-[#eff3f8] max-md:w-full" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" className="h-10 min-h-10 rounded-[10px] bg-[#512a82] px-5 font-normal text-white hover:bg-[#512a82] max-md:w-full disabled:opacity-60" disabled={createMutation.isPending || operatorName.trim().length < 2 || gateName.trim().length < 2}>Gerar e copiar link</Button>
            </DialogFooter>
          </form>
          {createMutation.isPending && <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/15" aria-busy="true"><LoadingDots label="Gerando link do leitor" /></div>}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}
        title="Excluir acesso do leitor?"
        description={deleteTarget ? `O link de ${deleteTarget.operatorName} · ${deleteTarget.gateName} será revogado. O histórico de check-ins permanecerá salvo.` : ''}
        confirmText="Excluir acesso"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget); }}
      />
    </>
  );
}
