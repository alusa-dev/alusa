import { PasswordForm } from '@/features/account/components/PasswordForm';

export default function ContaSegurancaPage() {
  return (
    <section
      aria-labelledby="seguranca-title"
      className="space-y-6 rounded-lg bg-white p-6 md:p-8"
    >
      <header className="space-y-1">
        <h2
          id="seguranca-title"
          className="text-xl md:text-2xl font-medium tracking-tight text-gray-900"
        >
          Segurança
        </h2>
        <p className="text-sm text-gray-600">
          Altere sua senha com políticas fortes de segurança.
        </p>
      </header>
      <PasswordForm />
    </section>
  );
}
