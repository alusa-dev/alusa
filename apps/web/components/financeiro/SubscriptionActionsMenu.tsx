'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { pushToast } from '@/components/ui/toast';
import { Eye, MoreVertical, Trash2 } from 'lucide-react';

interface SubscriptionActionsMenuProps {
  subscriptionId: string;
  asaasSubscriptionId?: string | null;
  status: string;
  matriculaId?: string | null;
  onActionComplete?: () => void | Promise<void>;
}

export function SubscriptionActionsMenu({
  subscriptionId,
  asaasSubscriptionId,
  status,
  matriculaId,
  onActionComplete,
}: SubscriptionActionsMenuProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const normalizedStatus = String(status || '').toUpperCase();
  const canDelete = Boolean(asaasSubscriptionId) && !['DELETED', 'EXPIRED'].includes(normalizedStatus);

  async function handleDelete() {
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/subscriptions/${subscriptionId}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || 'Falha ao excluir assinatura');
      }

      pushToast({
        title: 'Sucesso',
        description: payload?.message || 'Assinatura excluída com sucesso.',
        variant: 'success',
      });
      await onActionComplete?.();
      router.refresh();
    } catch (error) {
      pushToast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Falha ao excluir assinatura.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Ações da assinatura"
            onClick={(event) => event.preventDefault()}
          >
            <MoreVertical className="h-4 w-4 text-gray-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Recomendadas</div>
          <DropdownMenuItem onClick={() => router.push(`/cobrancas/assinaturas/${subscriptionId}`)}>
            <Eye className="mr-2 h-4 w-4" />
            Ver detalhes
          </DropdownMenuItem>
          {canDelete && (
            <DropdownMenuItem
              onClick={() => setConfirmOpen(true)}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir assinatura
            </DropdownMenuItem>
          )}

          {matriculaId && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Navegação</div>
              <DropdownMenuItem onClick={() => router.push(`/matriculas/${matriculaId}`)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver matrícula
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Excluir assinatura?"
        description="Esta ação usa a exclusão oficial da assinatura no Asaas. A Alusa atualiza o espelho local somente após confirmar o recurso externo."
        confirmText="Excluir assinatura"
        cancelText="Voltar"
        variant="destructive"
        loading={loading}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </>
  );
}