'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { pushToast } from '@/components/ui/toast';

import type { AccountVerificationResponse, VerificationAction } from '../constants';

type Props = {
  action: VerificationAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: () => void;
  fetchFresh: () => Promise<{ data: AccountVerificationResponse | null; reason?: string }>;
};

export function KycExternalModal({ action, open, onOpenChange, onStatusChange, fetchFresh }: Props) {
  const mountedRef = useRef(true);
  const [statusMessage, setStatusMessage] = useState(
    'Abra o link e finalize o envio. Esta tela atualiza automaticamente.',
  );
  const [expiredState, setExpiredState] = useState<'NONE' | 'REFRESHING' | 'REQUEST_NEW_LINK'>('NONE');

  const isRedirect = action?.mode === 'REDIRECT';
  const url = isRedirect ? (action.redirectUrl ?? '') : '';
  const isExpired = isRedirect ? Boolean(action.isRedirectExpired) : false;

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      pushToast({ title: 'Link copiado!', variant: 'success' });
    } catch {
      pushToast({ title: 'Erro ao copiar', variant: 'error' });
    }
  }, [url]);

  const shareLink = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Verificação da conta', url });
      } catch {
        // usuário cancelou
      }
    } else {
      await copyToClipboard();
    }
  }, [url, copyToClipboard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || !action) return;
    if (action.mode !== 'REDIRECT') return;

    setExpiredState('NONE');
    setStatusMessage('Abra o link e finalize o envio. Esta tela atualiza automaticamente.');

    if (!action.redirectUrl) {
      setExpiredState('REFRESHING');
      setStatusMessage('Buscando link de verificação...');
      return;
    }

    if (action.isRedirectExpired) {
      setExpiredState('REQUEST_NEW_LINK');
      setStatusMessage('Link expirado. Atualize para continuar.');
    }
  }, [open, action]);

  if (!action) return null;
  if (action.mode !== 'REDIRECT') return null;

  const showRefreshOnly = expiredState !== 'NONE' || !url || isExpired;

  const refreshLink = async () => {
    setExpiredState('REFRESHING');
    setStatusMessage('Atualizando...');

    try {
      const res = await fetchFresh();
      if (!mountedRef.current) return;

      const refreshed = res.data?.actions.find((a) => a.id === action.id);
      const freshUrl = refreshed?.mode === 'REDIRECT' ? refreshed.redirectUrl : undefined;
      const freshExpired = refreshed?.mode === 'REDIRECT' ? Boolean(refreshed.isRedirectExpired) : false;

      if (freshUrl && !freshExpired) {
        window.open(freshUrl, '_blank', 'noopener,noreferrer');
        setExpiredState('NONE');
        setStatusMessage('Link atualizado. Continue o envio no navegador.');
        return;
      }

      setExpiredState('REQUEST_NEW_LINK');
      setStatusMessage('Não foi possível obter um link válido. Tente novamente.');
    } catch {
      if (!mountedRef.current) return;
      setExpiredState('REQUEST_NEW_LINK');
      setStatusMessage('Erro ao atualizar. Tente novamente.');
    }
  };

  if (showRefreshOnly) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{action.label}</DialogTitle>
            <DialogDescription>
              {expiredState === 'REFRESHING'
                ? 'Atualizando o link...'
                : 'O link de verificação não está disponível ou expirou.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{statusMessage}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refreshLink}>
                Atualizar
              </Button>
              <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          {action.description && (
            <DialogDescription>{action.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-white rounded-lg border">
              <QRCodeSVG value={url} size={180} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyToClipboard}>
                Copiar link
              </Button>
              <Button variant="outline" size="sm" onClick={shareLink}>
                Compartilhar
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                Escaneie o QR Code ou abra o link para completar a verificação.
              </p>
              <Button
                className="w-full"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              >
                Abrir verificação
              </Button>
            </div>

            <div className="mt-auto pt-4 border-t">
              <div className="text-sm text-muted-foreground">{statusMessage}</div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={refreshLink}>
                  Atualizar link
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
