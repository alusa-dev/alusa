// Utilitário para construir URL de convite com validações básicas e sem dependências externas.
// - Valida baseUrl absoluto com http(s)
// - Valida token com tamanho mínimo de 10 caracteres
// - Usa a Web API URL para compor com segurança

export function buildInviteUrl(baseUrl: string, token: string): string {
  // Sanitização rápida dos parâmetros
  const base = String(baseUrl ?? '').trim();
  const tk = String(token ?? '').trim();

  // Validação do baseUrl absoluto (http/https)
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('baseUrl inválido: deve ser uma URL absoluta iniciando com http(s)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('baseUrl inválido: protocolo deve ser http ou https');
  }

  // Validação do token
  if (tk.length < 10) {
    throw new Error('token inválido: mínimo de 10 caracteres');
  }

  // Montagem segura da URL final
  const out = new URL('/auth/register', url);
  out.searchParams.set('token', tk);
  return out.toString();
}
