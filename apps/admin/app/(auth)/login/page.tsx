import { LoginForm } from './LoginForm';

export default async function AdminLoginPage({ searchParams }: { searchParams?: Promise<{ callbackUrl?: string }> }) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' && params.callbackUrl.startsWith('/') ? params.callbackUrl : '/';
  return <main className="admin-login"><section className="login-card"><p className="eyebrow">Alusa Admin</p><h1>Acesso administrativo</h1><p className="muted">Use sua identidade administrativa persistida para acessar as operações da plataforma.</p><LoginForm callbackUrl={callbackUrl} /></section></main>;
}
