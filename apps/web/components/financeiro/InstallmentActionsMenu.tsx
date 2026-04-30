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

interface InstallmentActionsMenuProps {
  installmentId: string;
  asaasInstallmentId?: string | null;
  statusConsolidado: 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';
  matriculaId?: string | null;
  contratoId?: string | null;
  onActionComplete?: () => void | Promise<void>;
}

export function InstallmentActionsMenu({
  installmentId,
  asaasInstallmentId,
  statusConsolidado,
  matriculaId,
  contratoId,
  onActionComplete,
}: InstallmentActionsMenuProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canCancelPendingPayments =
    Boolean(asaasInstallmentId) && statusConsolidado !== 'QUITADO' && statusConsolidado !== 'CANCELADO';

  async function handleCancelPendingPayments() {
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/installments/${installmentId}/payments`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || 'Falha ao cancelar parcelamento');
      }

      pushToast({
        title: 'Sucesso',
        description: payload?.message || 'Parcelamento atualizado com sucesso.',
        variant: 'success',
      });
      await onActionComplete?.();
      router.refresh();
    } catch (error) {
      pushToast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Falha ao cancelar parcelamento.',
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
            aria-label="Ações do parcelamento"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4 text-gray-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" onClick={(event) => event.stopPropagation()}>
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Recomendadas</div>
          <DropdownMenuItem onClick={() => router.push(`/cobrancas/parcelamentos/${installmentId}`)}>
            <Eye className="mr-2 h-4 w-4" />
            Ver detalhes
          </DropdownMenuItem>
          {canCancelPendingPayments && (
            <DropdownMenuItem
              onClick={() => setConfirmOpen(true)}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Cancelar cobranças pendentes e vencidas
            </DropdownMenuItem>
          )}

          {(matriculaId || contratoId) && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Navegação</div>
              {matriculaId && (
                <DropdownMenuItem onClick={() => router.push(`/matriculas/${matriculaId}`)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver matrícula
                </DropdownMenuItem>
              )}
              {contratoId && (
                <DropdownMenuItem onClick={() => router.push(`/contratos/${contratoId}`)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver contrato
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancelar cobranças pendentes e vencidas do parcelamento?"
        description="Esta ação usa o endpoint oficial do Asaas para remover cobranças pendentes e vencidas do parcelamento. A Alusa convergirá o estado local após a confirmação oficial."
        confirmText="Cancelar cobranças"
        cancelText="Voltar"
        variant="destructive"
        loading={loading}
        onConfirm={() => {
          void handleCancelPendingPayments();
        }}
      />
    </>
  );
}