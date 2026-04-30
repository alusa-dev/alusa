'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { IMaskInput } from 'react-imask';
import { toast } from '@/components/ui/toast';

import { useUserStore, type UserState } from '@/lib/stores/user-store';
import { CustomToast } from '@/components/ui/toast';
// Alerts não usados diretamente; feedback via toasts e mensagens inline
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
// Removido Card: evitamos box dentro de box; o layout externo já fornece o container
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PROFILE_LOCALE_OPTIONS,
  PROFILE_LOCALE_VALUES,
  PROFILE_THEME_OPTIONS,
  PROFILE_THEME_VALUES,
} from '@/lib/profile-preferences';
import {
  fetchCurrentProfile,
  updateCurrentProfile,
  ProfileUpdateError,
} from '@/features/account/services/profile-service';
import {
  uploadAvatarFile,
  updateAvatar,
  deleteUploadedFile,
} from '@/features/account/services/avatar-service';
import ImageCropDialog from '@/components/image/ImageCropDialog';

const BIO_LIMIT = 280;

const formSchema = z.object({
  name: z.string().trim().min(2, 'Informe um nome valido').max(120, 'Nome muito longo'),
  email: z.string().trim().email('Email invalido'),
  telefone: z.string().trim().max(20, 'Telefone invalido').optional().or(z.literal('')),
  bio: z
    .string()
    .trim()
    .max(BIO_LIMIT, `Bio deve ter no maximo ${BIO_LIMIT} caracteres`)
    .optional()
    .or(z.literal('')),
  locale: z.enum(PROFILE_LOCALE_VALUES),
  theme: z.enum(PROFILE_THEME_VALUES),
  foto: z.union([z.string().url(), z.literal('')]).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const inputClasses =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const maskOptions = [{ mask: '(00) 0000-0000' }, { mask: '(00) 00000-0000' }];

function ProfileCardSkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <div className="flex justify-end">
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}

export function ProfileForm() {
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarSource, setAvatarSource] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      email: '',
      telefone: '',
      bio: '',
      locale: PROFILE_LOCALE_VALUES[0],
      theme: PROFILE_THEME_VALUES[0],
      foto: '',
    },
  });

  const updateUser = useUserStore((s: UserState) => s.updateUser);

  const bioValue = watch('bio') ?? '';
  const bioCount = bioValue.length;
  const telefoneValue = watch('telefone') ?? '';
  const fotoValue = watch('foto') ?? '';
  const nameValue = watch('name') ?? '';
  const emailValue = watch('email') ?? '';
  const hasPhoneDigits = useMemo(
    () => telefoneValue.replace(/\D/g, '').length > 0,
    [telefoneValue],
  );
  const avatarFallback = useMemo(() => {
    const source = (nameValue || emailValue).trim();
    if (!source) return '??';
    const parts = source.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [nameValue, emailValue]);
  const handleAvatarDialogChange = useCallback((open: boolean) => {
    setAvatarDialogOpen(open);
    if (!open) {
      setAvatarSource(null);
    }
  }, []);

  const handleSelectFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setAvatarError(null);
    if (!file.type.startsWith('image/')) {
      setAvatarError('Selecione um arquivo de imagem valido.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setAvatarSource(result);
        setAvatarDialogOpen(true);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const handleAvatarApply = useCallback(
    async (result: { dataUrl: string; blob: Blob }) => {
      try {
        setAvatarUploading(true);
        setAvatarError(null);
        const ext =
          result.blob.type === 'image/png'
            ? 'png'
            : result.blob.type === 'image/webp'
              ? 'webp'
              : 'jpg';
        const filename = `avatar-${Date.now()}.${ext}`;
        const uploadedUrl = await uploadAvatarFile(result.blob, filename);
        // Guardar o anterior para limpeza
        const previous = fotoValue || '';
        await updateAvatar(uploadedUrl);
        setValue('foto', uploadedUrl, { shouldDirty: false });
        setLastSavedAt(new Date());
        // Atualiza a store com a nova URL e notifica consumidores do avatar (header/menu)
        try {
          updateUser({ foto: uploadedUrl });
        } catch {
          // ignore
        }
        try {
          window.dispatchEvent(new CustomEvent('user:updated', { detail: { foto: uploadedUrl } }));
        } catch {
          // ignore
        }
        // Limpeza best-effort do arquivo anterior
        if (previous && previous.startsWith('/uploads/')) {
          void deleteUploadedFile(previous);
        }
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Avatar atualizado"
            description="Sua foto de perfil foi atualizada."
            onClose={() => toast.dismiss(t)}
          />
        ));
        setAvatarSource(null);
      } catch (error) {
        const message =
          error instanceof ProfileUpdateError
            ? error.formErrors?.[0] ||
              Object.values(error.fieldErrors ?? {})[0]?.[0] ||
              error.message
            : error instanceof Error
              ? error.message
              : 'Falha ao atualizar avatar';
        setAvatarError(message);
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Erro ao atualizar avatar"
            description={message}
            onClose={() => toast.dismiss(t)}
          />
        ));
      } finally {
        setAvatarUploading(false);
      }
    },
    [setValue, setLastSavedAt, fotoValue, updateUser],
  );

  const handleRemoveAvatar = useCallback(async () => {
    try {
      setAvatarUploading(true);
      setAvatarError(null);
      const previous = fotoValue || '';
      await updateAvatar(null);
      setValue('foto', '', { shouldDirty: false });
      setLastSavedAt(new Date());
      try {
        updateUser({ foto: null });
      } catch {
        // ignore
      }
      try {
        window.dispatchEvent(new CustomEvent('user:updated', { detail: { foto: null } }));
      } catch {
        // ignore
      }
      if (previous && previous.startsWith('/uploads/')) {
        void deleteUploadedFile(previous);
      }
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Avatar removido"
          description="Sua foto de perfil foi removida."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (error) {
      const message =
        error instanceof ProfileUpdateError
          ? error.formErrors?.[0] || Object.values(error.fieldErrors ?? {})[0]?.[0] || error.message
          : error instanceof Error
            ? error.message
            : 'Falha ao remover avatar';
      setAvatarError(message);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao remover avatar"
          description={message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setAvatarUploading(false);
    }
  }, [setValue, setLastSavedAt, fotoValue, updateUser]);

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        setInitialError(null);
        const profile = await fetchCurrentProfile({ signal });
        reset(
          {
            name: profile.name ?? '',
            email: profile.email ?? '',
            telefone: profile.telefone ?? '',
            bio: profile.bio ?? '',
            locale: profile.locale as 'pt-BR' | 'en-US',
            theme: profile.theme as 'system' | 'light' | 'dark',
            foto: profile.foto ?? '',
          },
          { keepDirty: false },
        );
        try {
          updateUser({
            name: profile.name ?? undefined,
            email: profile.email ?? undefined,
            foto: profile.foto ?? null,
          });
        } catch {
          // ignore
        }
      } catch (error) {
        // Ignora aborts do fetch para evitar mensagens ruidosas de erro
        if (
          (error as { name?: string })?.name === 'AbortError' ||
          (error instanceof Error && /abort/i.test(error.message))
        ) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Falha ao carregar informacoes do perfil';
        setInitialError(message);
      } finally {
        setLoading(false);
      }
    },
    [reset, updateUser],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        const result = await updateCurrentProfile({
          name: values.name,
          telefone: values.telefone ?? '',
          bio: values.bio ?? '',
          locale: values.locale,
          theme: values.theme,
        });

        reset(
          {
            name: result.name ?? '',
            email: result.email ?? '',
            telefone: result.telefone ?? '',
            bio: result.bio ?? '',
            locale: result.locale,
            theme: result.theme,
            foto: result.foto ?? '',
          },
          { keepDirty: false },
        );

        setLastSavedAt(new Date());
        try {
          updateUser({
            name: result.name,
            foto: result.foto,
            locale: result.locale,
            theme: result.theme,
          });
        } catch {
          // ignore
        }
        try {
          window.dispatchEvent(
            new CustomEvent('user:updated', {
              detail: {
                name: result.name,
                foto: result.foto,
                locale: result.locale,
                theme: result.theme,
              },
            }),
          );
        } catch {
          // ignore
        }
        toast.custom((t) => (
          <CustomToast
            variant="success"
            title="Perfil atualizado"
            description="Dados salvos com sucesso."
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

          const description = error.formErrors?.[0] ?? error.message;
          toast.custom((t) => (
            <CustomToast
              variant="error"
              title="Falha ao salvar"
              description={description}
              onClose={() => toast.dismiss(t)}
            />
          ));
          return;
        }

        const message = error instanceof Error ? error.message : 'Falha inesperada ao salvar';
        toast.custom((t) => (
          <CustomToast
            variant="error"
            title="Falha ao salvar"
            description={message}
            onClose={() => toast.dismiss(t)}
          />
        ));
      }
    },
    [reset, setError, updateUser],
  );

  if (loading) {
    return <ProfileCardSkeleton />;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {initialError ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">Falha ao carregar dados</p>
          <p className="text-sm text-destructive/90">{initialError}</p>
        </div>
      ) : null}
      <form
        className="space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(onSubmit)(event);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleSelectFile}
        />
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative h-24 w-24">
            <Avatar className="h-24 w-24 border border-slate-200">
              {fotoValue ? (
                <AvatarImage src={fotoValue} alt={`Avatar de ${nameValue || emailValue}`} />
              ) : null}
              <AvatarFallback className="text-base font-medium">{avatarFallback}</AvatarFallback>
            </Avatar>
            {avatarUploading && (
              <div className="absolute inset-0 grid place-items-center rounded-full bg-black/40">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Foto de perfil</p>
              <p className="text-xs text-muted-foreground">
                PNG, JPG ou WebP ate 15MB. Ajuste o corte antes de salvar.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={avatarUploading || isSubmitting}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarUploading ? 'Enviando...' : 'Trocar foto'}
              </Button>
              {fotoValue ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={avatarUploading || isSubmitting}
                    >
                      Remover
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover foto?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Sua foto atual sera removida e substituida pelas iniciais.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          void handleRemoveAvatar();
                        }}
                      >
                        Remover avatar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            {avatarError ? <p className="text-xs text-destructive">{avatarError}</p> : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              autoComplete="name"
              {...register('name')}
              aria-invalid={errors.name ? 'true' : 'false'}
              aria-describedby={errors.name ? 'name-error' : undefined}
              disabled={isSubmitting}
            />
            {errors.name ? (
              <p id="name-error" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              disabled
              aria-readonly="true"
            />
            <p className="text-xs text-muted-foreground">
              Atualize o email na secao de seguranca abaixo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telefone">Telefone</Label>
            <Controller
              name="telefone"
              control={control}
              render={({ field }) => (
                <IMaskInput
                  id="telefone"
                  inputMode="tel"
                  mask={maskOptions}
                  value={field.value ?? ''}
                  onAccept={(value: string) => field.onChange(value)}
                  onBlur={field.onBlur}
                  className={inputClasses}
                  disabled={isSubmitting}
                  aria-invalid={errors.telefone ? 'true' : 'false'}
                  aria-describedby={errors.telefone ? 'telefone-error' : undefined}
                />
              )}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{hasPhoneDigits ? 'Numero com DDD' : 'Opcional'}</span>
              {errors.telefone ? (
                <p id="telefone-error" className="text-destructive">
                  {errors.telefone.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="locale">Idioma</Label>
            <Controller
              name="locale"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting}>
                  <SelectTrigger
                    id="locale"
                    aria-invalid={errors.locale ? 'true' : 'false'}
                    aria-describedby={errors.locale ? 'locale-error' : undefined}
                  >
                    <SelectValue placeholder="Selecione um idioma" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFILE_LOCALE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.locale ? (
              <p id="locale-error" className="text-xs text-destructive">
                {errors.locale.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              rows={4}
              maxLength={BIO_LIMIT}
              {...register('bio')}
              disabled={isSubmitting}
              aria-invalid={errors.bio ? 'true' : 'false'}
              aria-describedby={errors.bio ? 'bio-error' : 'bio-helper'}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {errors.bio ? (
                <p id="bio-error" className="text-destructive">
                  {errors.bio.message}
                </p>
              ) : (
                <span id="bio-helper">Apresentacao curta da equipe e dos clientes.</span>
              )}
              <span>
                {bioCount}/{BIO_LIMIT}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme">Tema</Label>
            <Controller
              name="theme"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting}>
                  <SelectTrigger
                    id="theme"
                    aria-invalid={errors.theme ? 'true' : 'false'}
                    aria-describedby={errors.theme ? 'theme-error' : undefined}
                  >
                    <SelectValue placeholder="Selecione um tema" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFILE_THEME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.theme ? (
              <p id="theme-error" className="text-xs text-destructive">
                {errors.theme.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground md:justify-end">
          {lastSavedAt ? (
            <span>
              Ultima atualizacao{' '}
              {lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting || avatarUploading || !isDirty}
              onClick={() => reset()}
            >
              Desfazer
            </Button>
            <Button type="submit" disabled={isSubmitting || avatarUploading || !isDirty}>
              {isSubmitting ? 'Salvando...' : 'Salvar alteracoes'}
            </Button>
          </div>
        </div>
      </form>
      <ImageCropDialog
        open={avatarDialogOpen}
        onOpenChange={handleAvatarDialogChange}
        src={avatarSource}
        aspect={1}
        round
        exportMime="image/jpeg"
        exportQuality={0.92}
        exportSize={512}
        onApply={(result) => {
          void handleAvatarApply(result);
        }}
      />
    </div>
  );
}
