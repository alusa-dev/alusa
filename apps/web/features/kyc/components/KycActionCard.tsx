'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VerificationAction } from '../constants';
import { getKycActionLabel } from '../document-guidance';

type Props = {
  action: VerificationAction;
  onAction: (action: VerificationAction) => void;
  onSandboxApprove?: () => void;
  isSandbox?: boolean;
};

export function KycActionCard({ action, onAction, onSandboxApprove, isSandbox }: Props) {
  const effectiveMode: VerificationAction['mode'] = action.submissionMethod === 'INTERNAL_UPLOAD'
    ? 'UPLOAD'
    : action.mode;
  // Estado transitório: provedor ainda processando a conta.
  if (action.mode === 'WAITING_PROVIDER') {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-medium">{action.label}</CardTitle>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              Aguardando verificação
            </span>
          </div>
          {action.responsible?.name && (
            <p className="text-xs text-muted-foreground mt-1">
              Responsável: {action.responsible.name}
            </p>
          )}
        </CardHeader>
      </Card>
    );
  }

  // Timeout de provisionamento: ação disponível (sandbox pode aprovar direto)
  if (action.mode === 'PROVISIONING_TIMEOUT') {
    return (
      <Card className="w-full border-amber-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-medium">{action.label}</CardTitle>
            <Badge variant="warning">Timeout</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            A verificação não foi provisionada dentro do prazo esperado.
          </p>
          {action.responsible?.name && (
            <p className="text-xs text-muted-foreground mt-1">
              Responsável: {action.responsible.name}
            </p>
          )}
        </CardHeader>
        {isSandbox && onSandboxApprove && (
          <CardContent className="pt-0">
            <Button variant="default" size="sm" onClick={onSandboxApprove}>
              Aprovar conta (sandbox)
            </Button>
          </CardContent>
        )}
      </Card>
    );
  }

  if (effectiveMode === 'PROVIDER_PORTAL_REQUIRED') {
    return (
      <Card className="w-full border-amber-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-medium">{action.label}</CardTitle>
            <Badge variant={action.status === 'REJECTED' ? 'destructive' : 'outline'}>
              {action.status === 'REJECTED' ? 'Requer atenção' : 'Ação externa'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {action.description ?? 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.'}
          </p>
          {action.responsible?.name && (
            <p className="text-xs text-muted-foreground mt-1">
              Responsável: {action.responsible.name}
            </p>
          )}
        </CardHeader>
      </Card>
    );
  }

  const badge = action.status === 'REJECTED'
    ? { label: 'Rejeitado', variant: 'destructive' as const }
    : { label: 'Pendente', variant: 'warning' as const };
  const guidanceAction = { ...action, mode: effectiveMode } as typeof action;
  const actionLabel = effectiveMode === 'UPLOAD' && (action.slots?.length ?? 0) > 1
    ? 'Enviar arquivos'
    : getKycActionLabel(guidanceAction as any);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-medium">{action.label}</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {action.description && (
          <p className="text-sm text-muted-foreground mt-1">{action.description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <Button variant="default" size="sm" onClick={() => onAction({ ...action, mode: effectiveMode })}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
