'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';

import { CustomToast } from '@/components/ui/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProfileUpdateError } from '@/features/account/services/profile-service';
import { changeEmail } from '@/features/account/services/security-service';

const schema = z.object({
  newEmail: z
    .string()
    .email('Informe um email valido')
    .transform((value) => value.trim()),
  currentPassword: z.string().min(1, 'Informe sua senha atual'),
});

type FormValues = z.infer<typeof schema>;

export function EmailChangeForm() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      newEmail: '',
      currentPassword: '',
    },
  });

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        const result = await changeEmail({
          newEmail: values.newEmail,
          currentPassword: values.currentPassword,
        });
        reset({ newEmail: '', currentPassword: '' });
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Email atualizado"
            description="Entre novamente para confirmar as alteracoes."
            onClose={() => toast.dismiss(t)}
          />
        ));
        return result;
      } catch (error) {
        if (error instanceof ProfileUpdateError) {
          if (error.fieldErrors) {
            Object.entries(error.fieldErrors).forEach(([field, messages]) => {
              const message = messages?.[0];
              if (message) {
                setError(field as keyof FormValues, { type: 'server', message });
              }
            });
          }
          toast.custom((t) => (
            <CustomToast
              variant="error"
              title="Falha ao atualizar email"
              description={error.formErrors?.[0] ?? error.message}
              onClose={() => toast.dismiss(t)}
            />
          ));
          return;
        }
        const message = error instanceof Error ? error.message : 'Falha ao atualizar email';
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Falha ao atualizar email"
            description={message}
            onClose={() => toast.dismiss(t)}
          />
        ));
      }
      return undefined;
    },
    [reset, setError],
  );

  return (
    <div className="max-w-3xl space-y-4">
      <Alert variant="warning">
        <AlertTitle>Importante</AlertTitle>
        <AlertDescription>
          Ao mudar o email sera necessario entrar novamente. O novo endereco precisa estar
          disponivel e recebera notificacoes da plataforma.
        </AlertDescription>
      </Alert>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(onSubmit)(event);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="newEmail">Novo email</Label>
          <Input
            id="newEmail"
            type="email"
            autoComplete="email"
            {...register('newEmail')}
            aria-invalid={errors.newEmail ? 'true' : 'false'}
            aria-describedby={errors.newEmail ? 'newEmail-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.newEmail ? (
            <p id="newEmail-error" className="text-xs text-destructive">
              {errors.newEmail.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email-password">Senha atual</Label>
          <Input
            id="email-password"
            type="password"
            autoComplete="current-password"
            {...register('currentPassword')}
            aria-invalid={errors.currentPassword ? 'true' : 'false'}
            aria-describedby={errors.currentPassword ? 'emailPassword-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.currentPassword ? (
            <p id="emailPassword-error" className="text-xs text-destructive">
              {errors.currentPassword.message}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Atualizando...' : 'Atualizar email'}
          </Button>
        </div>
      </form>
    </div>
  );
}
