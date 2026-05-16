'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export type SupportWhitelabelBaasRecoverDialogProps = {
  contaId: string;
  variant: 'blocked' | 'recover' | 'sync';
  blockedMessage?: string;
};

export function SupportWhitelabelBaasRecoverDialog({
  contaId,
  variant,
  blockedMessage,
}: SupportWhitelabelBaasRecoverDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmedTutorial, setConfirmedTutorial] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const reasonValid = reason.trim().length >= 8;
  const canSubmit =
    variant !== 'blocked' && (variant === 'sync' ? reasonValid : confirmedTutorial && reasonValid);

  async function submit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/developer/actions/recover-asaas-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contaId, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { summary?: string; warnings?: string[] };
        error?: string;
      } | null;
      if (!res.ok || !json?.success) {
        setFeedback({ tone: 'err', text: json?.error ?? 'Não foi possível concluir o pedido.' });
        return;
      }
      const warnings = json.data?.warnings?.length ? `\n\n${json.data.warnings.join('\n')}` : '';
      setFeedback({ tone: 'ok', text: `${json.data?.summary ?? 'Concluído.'}${warnings}` });
      router.refresh();
    } catch {
      setFeedback({ tone: 'err', text: 'Falha de rede. Tente novamente.' });
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'blocked') {
    return (
      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
        <p className="font-medium">Integração Asaas</p>
        <p className="mt-1 text-amber-900/90">
          {blockedMessage ??
            'A recuperação automática só está disponível quando a escola já tem subconta vinculada no Asaas.'}
        </p>
      </div>
    );
  }

  const triggerLabel =
    variant === 'sync' ? 'Atualizar integração de pagamentos' : 'Corrigir integração de pagamentos';

  return (
    <div className="mt-4">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (loading) return;
          setOpen(next);
          if (!next) {
            setConfirmedTutorial(false);
            setFeedback(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="default" className="w-full sm:w-auto">
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border border-slate-200 bg-white shadow-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-left text-lg font-semibold text-slate-900">
              {variant === 'sync'
                ? 'Atualizar integração e dados financeiros'
                : 'Corrigir integração de pagamentos'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm text-slate-700">
            <p>
              {variant === 'sync'
                ? 'A conexão com o Asaas já está ativa. Pode verificar webhooks e alinhar o estado local com o provedor.'
                : 'A escola não opera cobranças até existir uma chave válida guardada na Alusa. O sistema vai gerar uma chave nova na subconta usando a conta master.'}
            </p>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="font-medium text-slate-900">Antes de continuar (conta master Asaas)</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  Entre no Asaas com a <strong>conta master</strong> da Alusa (não é o login da escola).
                </li>
                <li>
                  Abra <strong>Integrações</strong> e depois <strong>Chaves de API</strong>.
                </li>
                <li>
                  Em <strong>Gestão de chaves de API de subcontas</strong>, clique em{' '}
                  <strong>Habilitar acesso</strong>. A autorização vale por tempo limitado (veja a data no painel
                  Asaas).
                </li>
                <li>
                  Em <strong>Mecanismos de segurança</strong>, confirme se os <strong>IPs permitidos</strong>{' '}
                  incluem os servidores que executam esta ação (senão o Asaas pode recusar o pedido).
                </li>
              </ol>
            </div>

            {variant === 'recover' ? (
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={confirmedTutorial}
                  onCheckedChange={(v) => setConfirmedTutorial(v === true)}
                  disabled={loading}
                  className="mt-0.5"
                />
                <span>Confirmo que concluí os passos acima e a autorização ainda está válida.</span>
              </label>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Motivo (mínimo 8 caracteres)
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Recuperar integração após falha de provisionamento."
                disabled={loading}
                rows={3}
                className="resize-y border-slate-200"
              />
            </div>

            {feedback ? (
              <div
                className={
                  feedback.tone === 'ok'
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950'
                    : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-950'
                }
              >
                <p className="whitespace-pre-wrap">{feedback.text}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => setOpen(false)}
              className="border-slate-200"
            >
              Fechar
            </Button>
            <Button type="button" disabled={!canSubmit || loading} onClick={submit}>
              {loading ? 'A processar…' : variant === 'sync' ? 'Atualizar agora' : 'Gerar chave e atualizar tudo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
