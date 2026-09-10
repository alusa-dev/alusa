'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { logoutCurrentSession } from '@/lib/client/logout';

import { CustomToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, ChevronUp } from '@/components/icons/icons';
import {
  ACCOUNT_DEACTIVATION_REASON_CODES,
  ACCOUNT_DEACTIVATION_REASON_OPTIONS,
} from '@/features/account/deactivation-reasons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const schema = z.object({
  reasonCodes: z.array(z.enum(ACCOUNT_DEACTIVATION_REASON_CODES))
    .min(1, 'Selecione pelo menos um motivo')
    .max(3, 'Selecione no máximo 3 motivos'),
  comment: z.string().trim().max(1000, 'Escreva no máximo 1000 caracteres').optional(),
}).superRefine((values, ctx) => {
  if (values.reasonCodes.includes('OTHER') && !values.comment) {
    ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Descreva o outro motivo' });
          }
});

type FormValues = z.infer<typeof schema>;

type DeleteAccountApiResponse = {
  result: 'DEACTIVATED_INTERNAL';
  message: string;
};

export function DeleteAccountForm() {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reasonCodes: [], comment: '' },
  });

  const selectedReasons = watch('reasonCodes') ?? [];

  function toggleReason(reason: FormValues['reasonCodes'][number], checked: boolean) {
    const next = checked
      ? [...selectedReasons, reason]
      : selectedReasons.filter((item) => item !== reason);
    setValue('reasonCodes', next as FormValues['reasonCodes'], { shouldValidate: true });
  }

  async function onSubmit(values: FormValues) {
    setApiError(null);

    const requestId = globalThis.crypto?.randomUUID?.();
    const selectedLabels = values.reasonCodes
      .map((code) => ACCOUNT_DEACTIVATION_REASON_OPTIONS.find((reason) => reason.value === code)?.label)
      .filter(Boolean);
    const res = await fetch('/api/conta/excluir', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify({
        reason: selectedLabels.join('; '),
        reasonCodes: values.reasonCodes,
        comment: values.comment,
      }),
    }).catch(() => null);

    if (!res) {
      const msg = 'Falha de rede ao desativar a conta.';
      setApiError(msg);
      toast.error(<CustomToast variant="error" title="Erro" description={msg} />);
      return;
    }

    const json = (await res.json().catch(() => null)) as DeleteAccountApiResponse | null;

    if (!res.ok) {
      const fallback =
        res.status === 409
          ? 'Processo já em andamento. Tente novamente em instantes.'
          : res.status === 422
            ? 'Verifique o motivo e a confirmação.'
            : 'Não foi possível concluir a desativação agora. Tente novamente.';
      const message = json?.message ?? fallback;
      setApiError(message);
      toast.error(
        <CustomToast variant="error" title="Não foi possível desativar" description={message} />,
      );
      return;
    }

    const resultMessage =
      json?.message ??
      'Conta desativada. Para voltar a acessar, solicite a reativação pelo e-mail cadastrado.';

    toast.success(
      <CustomToast variant="success" title="Conta desativada" description={resultMessage} />,
    );
    setOpen(false);

    await logoutCurrentSession('/auth/login?deactivated=1');
  }

  return (
    <div className="pt-4">
      <div className="rounded-lg border border-destructive/20 bg-destructive/5">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:ring-inset"
          aria-expanded={expanded}
          aria-controls="account-deactivation-details"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="font-medium text-destructive">Desativar conta</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-destructive" aria-hidden /> : <ChevronDown className="h-4 w-4 text-destructive" aria-hidden />}
        </button>

        {expanded ? <div id="account-deactivation-details" className="border-t border-destructive/20 p-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive/80">
            <li>O acesso de todos os usuários será bloqueado.</li>
            <li>Os dados da conta serão preservados.</li>
            <li>A reativação poderá ser solicitada posteriormente.</li>
            <li>Se houver um plano ativo, a renovação será cancelada.</li>
          </ul>

          <Dialog
            open={open}
            onOpenChange={(val) => {
              if (!val) {
                reset();
                setApiError(null);
              }
              setOpen(val);
            }}
          >
            <div className="mt-4 flex justify-end">
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-[34px] rounded-[5px] border-[#cf322a] px-4 text-sm font-medium text-[#9b231d] shadow-none hover:bg-red-50 hover:text-[#9b231d] alusa-dark:border-red-400/60 alusa-dark:bg-transparent alusa-dark:text-red-200 alusa-dark:hover:bg-red-500/10"
                >
                  Desativar conta
                </Button>
              </DialogTrigger>
            </div>
            <DialogContent className="max-h-[calc(100dvh-2rem)] min-h-0 max-w-md grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-h-[560px]">
              <DialogHeader>
                <DialogTitle>Desativar conta?</DialogTitle>
                <DialogDescription>
                  Para nos ajudar a melhorar, conte por que você está desativando sua conta.
                </DialogDescription>
              </DialogHeader>

              <form
                id="delete-account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit(onSubmit)(event);
                }}
                className="flex min-h-0 flex-col gap-4 overflow-y-auto py-4 pr-2"
              >
                <div className="flex flex-col gap-3">
                  <div>
                    <Label>Qual o motivo do cancelamento?</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Selecione até 3 opções.</p>
                  </div>
                  <section
                    aria-label="Motivos do cancelamento"
                    className="overflow-hidden rounded-md border border-input divide-y divide-input"
                  >
                    {ACCOUNT_DEACTIVATION_REASON_OPTIONS.map((reason) => {
                      const checked = selectedReasons.includes(reason.value);
                      const disabled = isSubmitting || (!checked && selectedReasons.length >= 3);
                      return (
                        <div
                          key={reason.value}
                          className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          <Checkbox
                            id={`deactivation-reason-${reason.value.toLowerCase()}`}
                            checked={checked}
                            disabled={disabled}
                            aria-label={reason.label}
                            onCheckedChange={(value) => toggleReason(reason.value, value)}
                          />
                          <label
                            htmlFor={`deactivation-reason-${reason.value.toLowerCase()}`}
                            className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
                          >
                            {reason.label}
                          </label>
                        </div>
                      );
                    })}
                  </section>
                  {errors.reasonCodes && <p className="text-xs text-destructive">{errors.reasonCodes.message}</p>}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="deactivation-comment">
                    {selectedReasons.includes('OTHER') ? 'Descreva o motivo' : 'Quer contar mais alguma coisa?'}
                    {!selectedReasons.includes('OTHER') && <span className="font-normal text-muted-foreground"> (opcional)</span>}
                  </Label>
                  <Textarea
                    id="deactivation-comment"
                    placeholder="Conte um pouco mais"
                    maxLength={1000}
                    {...register('comment')}
                    disabled={isSubmitting}
                  />
                  {errors.comment && <p className="text-xs text-destructive">{errors.comment.message}</p>}
                </div>

                {apiError && <p className="text-sm text-destructive">{apiError}</p>}
              </form>

              <DialogFooter className="shrink-0 border-t border-gray-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  form="delete-account-form"
                  variant="destructive"
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Desativando...' : 'Confirmar desativação'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div> : null}
      </div>
    </div>
  );
}
