import { DeveloperLoginForm } from './DeveloperLoginForm';

export default function DeveloperLoginPage({
  searchParams,
}: {
  searchParams?: { callbackUrl?: string };
}) {
  const callbackUrl =
    typeof searchParams?.callbackUrl === 'string' && searchParams.callbackUrl.startsWith('/')
      ? searchParams.callbackUrl
      : '/developer';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-950">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-white p-6 shadow-xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Central Alusa</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            Acesso de suporte
          </h1>
        </div>
        <DeveloperLoginForm callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
