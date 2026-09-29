import { EmailChangeForm } from '@/features/account/components/EmailChangeForm';

export default function ContaEmailPage() {
  return (
    <section
      aria-labelledby="email-title"
      className="space-y-6 rounded-lg bg-white p-6 md:p-8"
    >
      <header className="space-y-1">
        <h2
          id="email-title"
          className="text-xl md:text-2xl font-medium tracking-tight text-gray-900"
        >
          E-mail
        </h2>
        <p className="text-sm text-gray-600">
          Solicite a troca de e-mail com confirmação de senha.
        </p>
      </header>
      <EmailChangeForm />
    </section>
  );
}
