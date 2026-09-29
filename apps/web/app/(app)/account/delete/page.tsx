import { DeleteAccountForm } from '@/features/account/components/DeleteAccountForm';

export default function ContaExcluirContaPage() {
  return (
    <section
      aria-labelledby="excluir-conta-title"
      className="space-y-6 rounded-lg bg-white p-6 md:p-8"
    >
      <header className="flex flex-col gap-1">
        <h2
          id="excluir-conta-title"
          className="text-xl md:text-2xl font-medium tracking-tight text-gray-900"
        >
          Desativar conta
        </h2>
        <p className="text-sm text-gray-600">
          O acesso será desativado, mas a conta continuará preservada para auditoria e possível reativação futura.
        </p>
      </header>

      <DeleteAccountForm />
    </section>
  );
}
