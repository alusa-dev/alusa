import { PasswordChangeWizard } from '@/features/account/components/PasswordChangeWizard';
import { SessionSecurityActions } from '@/features/account/components/SessionSecurityActions';

export default function ContaSegurancaPage() {
  return (
    <div
      aria-labelledby="seguranca-title"
      className="space-y-7 rounded-lg bg-white p-6 alusa-dark:bg-transparent md:p-8"
    >
      <header className="max-w-[520px]">
        <h2
          id="seguranca-title"
          className="text-2xl font-medium text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]"
        >
          Segurança
        </h2>
        <p className="mt-2 text-sm leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
          Gerencie sua senha e encerre acessos ativos para manter sua conta protegida.
        </p>
      </header>

      <PasswordChangeWizard />

      <SessionSecurityActions />
    </div>
  );
}
