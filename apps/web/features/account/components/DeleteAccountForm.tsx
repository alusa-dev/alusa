'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { signOut } from 'next-auth/react';

import { CustomToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  confirmText: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value === 'DESATIVAR', 'Digite DESATIVAR para confirmar'),
  removeReason: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= 5, 'Informe um motivo com pelo menos 5 caracteres'),
});

type FormValues = z.infer<typeof schema>;

type DeleteAccountApiResponse = {
  result: 'DEACTIVATED_INTERNAL';
  message: string;
};

export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setApiError(null);

    const res = await fetch('/api/conta/excluir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: values.removeReason, confirmText: values.confirmText }),
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

    await signOut({ callbackUrl: '/auth/login?deactivated=1' });
  }

  return (
    <div className="pt-4">
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-destructive">Zona de Perigo</h3>
            <p className="text-sm text-destructive/80">
              Seu acesso será desativado imediatamente, mas os dados da conta serão preservados para auditoria e possível reativação.
            </p>
          </div>
          <Dialog
            open={open}
            onOpenChange={(val) => {
              if (!val) reset();
              setOpen(val);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive">Desativar conta</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Desativar conta?</DialogTitle>
                <DialogDescription>
                  Seu acesso será interrompido agora. O histórico da conta será preservado para auditoria e para eventual reativação pelo e-mail cadastrado.
                </DialogDescription>
              </DialogHeader>

              <form
                id="delete-account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit(onSubmit)(event);
                }}
                className="flex flex-col gap-4 py-4"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="removeReason">Motivo da desativação</Label>
                  <Input
                    id="removeReason"
                    placeholder="Informe o motivo da desativação"
                    {...register('removeReason')}
                    disabled={isSubmitting}
                  />
                  {errors.removeReason && (
                    <p className="text-xs text-destructive">{errors.removeReason.message}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirmText">
                    Digite <span className="font-mono font-bold">DESATIVAR</span> para confirmar
                  </Label>
                  <Input
                    id="confirmText"
                    placeholder="DESATIVAR"
                    autoComplete="off"
                    {...register('confirmText')}
                    disabled={isSubmitting}
                  />
                  {errors.confirmText && (
                    <p className="text-xs text-destructive">{errors.confirmText.message}</p>
                  )}
                </div>

                {apiError && <p className="text-sm text-destructive">{apiError}</p>}
              </form>

              <DialogFooter>
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
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Desativando...' : 'Confirmar desativação'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
