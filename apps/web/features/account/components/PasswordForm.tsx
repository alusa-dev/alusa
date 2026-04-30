'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';

import { CustomToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProfileUpdateError } from '@/features/account/services/profile-service';
import { changePassword } from '@/features/account/services/security-service';

const passwordMinLength = Number(process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH || 8);
const passwordMessage =
  'Senha deve ter no minimo 8 caracteres, com maiuscula, minuscula, numero e simbolo.';
const passwordRegex = new RegExp(
  '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{' + String(passwordMinLength) + ',}$',
);

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: z.string().regex(passwordRegex, passwordMessage),
    confirmPassword: z.string().min(1, 'Confirme a nova senha'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas nao conferem',
  });

type FormValues = z.infer<typeof schema>;

export function PasswordForm() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        await changePassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
        reset();
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Senha atualizada"
            description="Sua senha foi alterada com sucesso."
            onClose={() => toast.dismiss(t)}
          />
        ));
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
              title="Falha ao atualizar senha"
              description={error.formErrors?.[0] ?? error.message}
              onClose={() => toast.dismiss(t)}
            />
          ));
          return;
        }

        const message = error instanceof Error ? error.message : 'Falha ao atualizar senha';
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Falha ao atualizar senha"
            description={message}
            onClose={() => toast.dismiss(t)}
          />
        ));
      }
    },
    [reset, setError],
  );

  return (
    <div className="max-w-3xl">
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(onSubmit)(event);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Senha atual</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...register('currentPassword')}
            aria-invalid={errors.currentPassword ? 'true' : 'false'}
            aria-describedby={errors.currentPassword ? 'currentPassword-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.currentPassword ? (
            <p id="currentPassword-error" className="text-xs text-destructive">
              {errors.currentPassword.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">Nova senha</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...register('newPassword')}
            aria-invalid={errors.newPassword ? 'true' : 'false'}
            aria-describedby={errors.newPassword ? 'newPassword-error' : undefined}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">{passwordMessage}</p>
          {errors.newPassword ? (
            <p id="newPassword-error" className="text-xs text-destructive">
              {errors.newPassword.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword')}
            aria-invalid={errors.confirmPassword ? 'true' : 'false'}
            aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.confirmPassword ? (
            <p id="confirmPassword-error" className="text-xs text-destructive">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Atualizando...' : 'Atualizar senha'}
          </Button>
        </div>
      </form>
    </div>
  );
}
