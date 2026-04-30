// pixel-perfect login
// Layout escopo (auth): centraliza vertical/horizontal, remove scroll e aplica fundo.
// Não recria <html>/<body>; root layout mantém providers/sessão.
import React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell">{children}</div>;
}