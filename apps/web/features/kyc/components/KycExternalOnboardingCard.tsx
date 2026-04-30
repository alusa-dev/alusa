'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pushToast } from '@/components/ui/toast';

import type { VerificationAction } from '../constants';

type Props = {
  action: VerificationAction;
  verifying?: boolean;
  onVerify: (action: VerificationAction) => Promise<void> | void;
};

type Step = {
  kind: 'number' | 'check';
  value?: string;
  text: string;
};

const steps: Step[] = [
  {
    kind: 'number',
    value: '1',
    text: 'Abra a camera do seu celular e aponte para o QR code ao lado. Se preferir, copie o link.',
  },
  {
    kind: 'number',
    value: '2',
    text: 'Siga as instruções apresentadas para tirar a foto do documento de identificação e a selfie.',
  },
  {
    kind: 'number',
    value: '3',
    text: 'Após enviar os documentos solicitados e concluir a selfie, aguarde a atualização automática desta tela ou clique em Verificar envio de documentos.',
  },
  {
    kind: 'check',
    text: 'Tudo certo com o envio. Esta tela será atualizada para a análise do documento e a continuidade da aprovação da conta.',
  },
];

function StepMarker({ step }: { step: Step }) {
  return (
    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500 text-sm font-semibold text-blue-600">
      {step.kind === 'check' ? <Check className="h-4 w-4" /> : step.value}
    </span>
  );
}

export function KycExternalOnboardingCard({ action, verifying = false, onVerify }: Props) {
  const [copied, setCopied] = useState(false);

  const url = action.redirectUrl?.trim() ?? '';
  const isUnavailable = !url || action.isRedirectExpired;
  const badge = action.status === 'REJECTED'
    ? { label: 'Requer correção', variant: 'destructive' as const }
    : { label: 'Envio externo', variant: 'warning' as const };

  const copyToClipboard = async () => {
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      pushToast({ title: 'Link copiado!', variant: 'success' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({ title: 'Erro ao copiar link', variant: 'error' });
    }
  };

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-medium">{action.label}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {action.description ?? 'Conclua o envio dos documentos em ambiente externo usando o link oficial da verificação.'}
            </p>
            {action.responsible?.name ? (
              <p className="text-xs text-muted-foreground">Responsável: {action.responsible.name}</p>
            ) : null}
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="rounded-xl border border-border/80 bg-background p-5 md:p-6">
          {isUnavailable ? (
            <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-900">
                  {action.isRedirectExpired ? 'O link de envio expirou.' : 'O link de envio ainda não está disponível.'}
                </p>
                <p className="text-sm text-amber-800">
                  Use a verificação abaixo para buscar um link válido no estado oficial da conta e continuar o envio externo.
                </p>
              </div>

              <Button type="button" variant="outline" onClick={() => void onVerify(action)} disabled={verifying}>
                {verifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Atualizando link...
                  </>
                ) : (
                  'Verificar envio de documentos'
                )}
              </Button>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
                  <QRCodeSVG value={url} size={190} />
                </div>

                <Button
                  type="button"
                  onClick={() => void copyToClipboard()}
                  className="min-w-[160px] bg-brand-accent text-white hover:bg-brand-accent/90"
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Link copiado
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar link
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-5">
                <div className="space-y-4">
                  {steps.map((step) => (
                    <div key={`${step.kind}-${step.value ?? step.text}`} className="flex items-start gap-3">
                      <StepMarker step={step} />
                      <p className="text-sm leading-6 text-foreground">{step.text}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <Button type="button" variant="outline" onClick={() => void onVerify(action)} disabled={verifying}>
                    {verifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verificando envio...
                      </>
                    ) : (
                      'Verificar envio de documentos'
                    )}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  A página já atualiza automaticamente. Este botão força uma nova consulta do estado oficial da conta.
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}