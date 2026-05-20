import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { InfoCallout } from '@/components/ui/info-callout';

export default async function HomePage() {
  let userCount: number | null = null;
  try {
    userCount = await prisma.usuario.count();
  } catch (error) {
    console.error('HomePage prisma error', error);
  }

  if (userCount !== null) {
    redirect(userCount > 0 ? 'https://alusa.app/' : '/auth/register');
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#3e1f63]">
      <div className="mx-auto w-[480px] max-w-[92vw] rounded-[40px] bg-white px-12 py-10 shadow-[0_6px_24px_rgba(0,0,0,0.12)] flex flex-col items-center">
        <img
          src="/brand/logo.svg"
          alt="Alusa"
          width={158}
          className="select-none mb-6 h-auto"
          draggable={false}
        />

        <div className="text-center mb-8 space-y-3">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">Bem-vindo ao Alusa</h1>
          <p className="text-[14px] font-medium text-gray-600">
            Para começar a usar a plataforma, é necessário criar a primeira conta de administrador.
          </p>
          <p className="text-[12px] text-gray-500">
            Esta conta terá acesso completo ao sistema e poderá convidar outros usuários.
          </p>
        </div>

        <div className="w-full max-w-[320px]">
          <Link
            href="/auth/register"
            className="w-full h-12 rounded-[30px] bg-[#5c2f91] hover:bg-[#4b217a] text-white text-[14px] font-medium flex items-center justify-center transition-colors outline-none"
          >
            Criar Primeira Conta
          </Link>
        </div>

        <InfoCallout size="sm" className="mt-6 rounded-2xl text-center">
          💡 Após criar a primeira conta, novos usuários só poderão se cadastrar através de convites.
        </InfoCallout>
      </div>
    </div>
  );
}
