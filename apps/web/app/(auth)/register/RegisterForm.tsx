// Página de registro: componente client isolado para permitir wrapper SSR em page.tsx
"use client";
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff, Mail } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { debugLog, isAuthDebug } from '@/lib/debug-logger';
import AuthShell from '@/components/auth/AuthShell';

export const REQUIRES_SCHOOL_DATA = false;

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
const passwordRequirementsText = 'Use no minimo 8 caracteres, com letra maiuscula, letra minuscula, numero e caractere especial.';



// Schema condicional por modo
const baseSchema = z.object({
  firstName: z.string().min(2, 'Informe o nome'),
  lastName: z.string().min(2, 'Informe o sobrenome'),
  email: z.string().email('E-mail inválido'),
  senha: z.string().regex(strongPassword, 'Senha fraca'),
  confirmarSenha: z.string(),
  termos: z.literal(true, { errorMap: () => ({ message: 'Você deve aceitar os termos' }) }),
});

function schemaFor() {
  return baseSchema.refine((data) => data.senha === data.confirmarSenha, {
    path: ['confirmarSenha'],
    message: 'Senhas não coincidem'
  });
}

// Tipos do formulário (superset para todos os modos)
type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  senha: string;
  confirmarSenha: string;
  termos: true;
};

interface InviteData {
  email?: string; // Opcional para RESPONSAVEL
  role: string;
  token: string;
  alunos?: Array<{
    id: string;
    nome: string;
    email: string | null;
    idade: number | null;
  }>;
}

type RegisterMode = 'first' | 'invite';

interface RegisterFormProps {
  inviteData?: InviteData;
}

export default function RegisterForm({ inviteData }: RegisterFormProps) {
  const mode: RegisterMode = inviteData ? 'invite' : 'first';
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const targetAfterVerification =
    mode === 'first' || inviteData?.role?.toUpperCase() === 'ADMIN'
      ? '/finance/wizard'
      : '/dashboard';
  const postRegisterRedirect = `/auth/confirm-email?callbackUrl=${encodeURIComponent(targetAfterVerification)}`;

  const schema = useMemo(() => schemaFor(), []);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      email: inviteData?.email || ''
    }
  });

  /* helpers removed */


  async function onSubmit(data: FormValues) {
    setGlobalError(null);
    const escolaNome = `${data.firstName} ${data.lastName}`.trim();

    try {
      if (isAuthDebug) debugLog('register', 'submit', { mode, email: data.email });
      let endpoint = '/api/users/first-register';
      let payload: Record<string, unknown> = {
        nome: `${data.firstName} ${data.lastName}`.trim(),
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        senha: data.senha,
        escolaNome
      };

      // Ajuste por modo
      if (mode === 'invite' && inviteData) {
        endpoint = '/api/users/accept';
        payload = {
          token: inviteData.token,
          name: `${data.firstName} ${data.lastName}`.trim(),
          email: data.email, // Envia o email (pode ser do convite ou digitado pelo usuário)
          password: data.senha,
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (isAuthDebug) debugLog('register', 'response', { status: res.status });

      const responsePayload = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        code: string;
        user: { email?: string; contaId?: string; emailVerified?: boolean };
      }>;

      if (!res.ok) {
        const isConflict = res.status === 409;
        const isDeactivatedAccount = isConflict && responsePayload.code === 'ACCOUNT_DEACTIVATED';
        const isAsaasEmailInUse = isConflict && responsePayload.code === 'ASAAS_EMAIL_IN_USE';
        const descText = isDeactivatedAccount
          ? 'Já existe uma conta desativada para este e-mail. Faça login para iniciar a reativação.'
          : responsePayload.error ?? (isConflict ? 'E-mail já cadastrado.' : 'Falha ao criar conta.');
        setGlobalError(descText);
        if (isAuthDebug) debugLog('register', 'error', { status: res.status, error: responsePayload.error });
        const descNode = isDeactivatedAccount ? (
          <span>
            Já existe uma conta desativada para este e-mail.{' '}
            <a href="/auth/login" className="underline">Faça login</a>{' '}
            para iniciar a reativação.
          </span>
        ) : isAsaasEmailInUse ? (
          'Este e-mail já está vinculado a um cadastro financeiro existente. Use outro e-mail para criar uma nova conta.'
        ) : isConflict ? (
          <span>
            Este e-mail já está em uso.{" "}
            <a href="/auth/login" className="underline">Fazer login</a>{" "}ou{" "}
            <a href="/auth/forgot-password" className="underline">recuperar senha</a>.
          </span>
        ) : (descText);
        toast.custom((t) => (
          <CustomToast
            variant={isDeactivatedAccount ? 'warning' : 'error'}
            title={isDeactivatedAccount ? 'Conta desativada encontrada' : isAsaasEmailInUse ? 'E-mail indisponível no cadastro financeiro' : isConflict ? 'E-mail já cadastrado' : 'Erro ao criar conta'}
            description={descNode}
            onClose={() => { toast.dismiss(t); }}
          />
        ));
        return;
      }

      const loginEmail = responsePayload.user?.email || data.email;
      const login = await signIn('credentials', {
        redirect: false,
        email: loginEmail,
        password: data.senha,
        contaId: responsePayload.user?.contaId,
      });
      if (isAuthDebug) debugLog('register', 'auto-login response', login);
      if (login?.error) {
        const desc = 'Conta criada, mas não foi possível autenticar.';
        setGlobalError(desc);
        toast.custom((t) => (
          <CustomToast
            variant="warning"
            title="Falha na autenticação"
            description="Faça login manualmente."
            onClose={() => { toast.dismiss(t); }}
          />
        ));
        return;
      }

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Conta criada"
          description="Redirecionando para confirmar seu e-mail..."
          onClose={() => { toast.dismiss(t); }}
        />
      ), { duration: 3000 });
      if (isAuthDebug) debugLog('register', 'success', { email: loginEmail });
      setTimeout(() => {
        window.location.href =
          mode === 'invite' && responsePayload.user?.emailVerified
            ? targetAfterVerification
            : postRegisterRedirect;
      }, 450);
    } catch {
      setGlobalError('Erro inesperado. Tente novamente.');
      if (isAuthDebug) debugLog('register', 'unexpected');
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro inesperado"
          description="Tente novamente."
          onClose={() => { toast.dismiss(t); }}
        />
      ));
    }
  }

  function onError() {
    const order: Array<keyof FormValues> = ['firstName', 'lastName', 'email', 'senha', 'confirmarSenha', 'termos'];
    for (const key of order) {
      const err = errors[key];
      if (!err) continue;
      const base = (err.message as string) || 'Campo inválido';
      if (isAuthDebug) debugLog('register', 'validation-error', { field: key, message: base });
      let title = 'Campo inválido';
      let desc = 'Revise o valor informado.';
      switch (key) {
        case 'firstName': title = 'Nome inválido'; desc = 'Informe um nome válido (mín. 2 letras).'; break;
        case 'lastName': title = 'Sobrenome inválido'; desc = 'Informe um sobrenome válido.'; break;
        case 'email': title = 'E-mail inválido'; desc = 'Preencha corretamente seu e-mail.'; break;
        case 'senha': title = 'Senha fraca'; desc = 'Use 8+ caracteres, maiúscula, minúscula, número e símbolo.'; break;
        case 'confirmarSenha': title = 'Senhas não coincidem'; desc = 'Garanta que as duas senhas são iguais.'; break;
        case 'termos': title = 'Termos necessários'; desc = 'Aceite os termos para continuar.'; break;
      }
      if (base && base !== 'Campo inválido') {
        if (key === 'senha' && base !== 'Senha fraca') { desc = base; }
      }
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title={title}
          description={desc}
          onClose={() => { toast.dismiss(t); }}
        />
      ));
      break;
    }
  }

  return (
    <AuthShell
      heroImageSrc="/brand/image-register.jpg"
      heroContent={(
        <div className="flex w-full justify-center -mt-6">
          <p className="max-w-[460px] text-center text-[30px] font-normal leading-tight tracking-[-0.02em] text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.24)]">
            Abra sua conta e conte com uma gestão escolar{' '}
            <span className="font-bold text-[#c9a6ff]">simples</span>
            {' '}e{' '}
            <span className="font-bold text-[#c9a6ff]">segura</span>.
          </p>
        </div>
      )}
    >
      <div data-layer="form register" className="w-full max-w-[320px] flex flex-col items-start">
        <header className="text-left mb-8 space-y-2">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">
            {mode === 'invite' ? 'Aceitar Convite' : 'Abra sua conta'}
          </h1>
          <p className="text-[12px] font-medium text-brand-muted">
            {mode === 'invite' && inviteData
              ? `Você foi convidado como ${inviteData.role} para acessar o sistema.`
              : 'Informe seu e-mail e defina uma senha para começar a abertura da sua conta na alusa.'
            }
          </p>
          {/* No modo convite, o e-mail é editável no campo abaixo (pré-preenchido pelo convite) */}
          {/* Erro global visível apenas se necessário */}
          {globalError && <p data-testid="register-error" className="text-[12px] text-red-600" role="alert">{globalError}</p>}
        </header>


        <form onSubmit={(e) => { void handleSubmit(onSubmit, onError)(e); }} className="w-full flex flex-col gap-4 items-start" data-testid="register-form" noValidate>
          <div className="flex gap-4 w-full">
            <div className="flex-1">
              <div className="relative h-12">
                <input type="text" placeholder="Nome" data-testid="register-nome-first" className="w-full h-12 rounded-[12px] border border-gray-300 bg-white px-5 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0" {...register('firstName')} />
              </div>
            </div>
            <div className="flex-1">
              <div className="relative h-12">
                <input type="text" placeholder="Sobrenome" data-testid="register-nome-last" className="w-full h-12 rounded-[12px] border border-gray-300 bg-white px-5 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0" {...register('lastName')} />
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="relative h-12">
              <input
                type="email"
                placeholder="Email"
                data-testid="register-email"
                autoComplete="email"
                className="w-full h-12 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0 disabled:bg-gray-100"
                {...register('email')}
                readOnly={mode === 'invite' && !!inviteData?.email}
                disabled={mode === 'invite' && !!inviteData?.email}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden><Mail className="h-4 w-4" /></span>
            </div>
          </div>
          <div className="w-full">
            <div className="relative h-12">
              <input type={showPassword ? 'text' : 'password'} placeholder="Senha" data-testid="register-senha" autoComplete="new-password" className="w-full h-12 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0" {...register('senha')} />
              <button type="button" onClick={() => { setShowPassword(s => !s); }} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted p-1 rounded outline-none">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
          </div>
          <div className="w-full">
            <div className="relative h-12">
              <input type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirmar senha" data-testid="register-senha-confirmar" autoComplete="new-password" className="w-full h-12 rounded-[12px] border border-gray-300 bg-white pl-5 pr-11 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0" {...register('confirmarSenha')} />
              <button type="button" onClick={() => { setShowConfirmPassword(s => !s); }} aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted p-1 rounded outline-none">{showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
            <p className="mt-2 px-1 text-[11px] font-medium leading-relaxed text-brand-muted">
              {passwordRequirementsText}
            </p>
          </div>
          <div className="pt-1">
            <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer select-none leading-relaxed">
              <input type="checkbox" className="h-4 w-4 rounded-[5px] border border-brand-accent accent-brand-accent outline-none" {...register('termos')} />
              <span className="text-[#686868]">Aceito os <a className="text-brand-accent hover:underline" href="/termos" target="_blank" rel="noopener noreferrer">Termos de Uso</a></span>
            </label>
          </div>
          <button type="submit" data-testid="register-submit" disabled={isSubmitting} className="w-full mt-1 h-12 rounded-[12px] bg-[#3e1f63] hover:bg-[#4b217a] text-white text-[14px] font-medium flex items-center justify-center transition-colors outline-none disabled:opacity-60">
            {isSubmitting ? 'Processando...' : (mode === 'invite' ? 'Aceitar Convite' : 'Criar conta')}
          </button>
          <p className="text-left text-[11px] font-medium mt-2">
            <span className="text-[#686868]">{mode === 'invite' ? 'Não recebeu este convite? ' : 'Já tenho uma conta! '}</span>
            <a href="/auth/login" className="text-brand-accent hover:underline">
              {mode === 'invite' ? 'Contatar administrador' : 'Fazer login'}
            </a>
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
