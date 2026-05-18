'use client';

import Image from 'next/image';

function requiresSessionCookieImage(src: string): boolean {
  if (src.startsWith('/api/files/') || src.startsWith('/uploads/')) {
    return true;
  }

  try {
    const pathname = new URL(src, 'https://alusa.app').pathname;
    return pathname.startsWith('/api/files/') || pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
}

type UserAvatarProps = {
  src: string;
  alt?: string;
  className?: string;
  sizes?: string;
};

/** Avatar do usuário — URLs autenticadas usam <img> para enviar cookies; demais usam next/image. */
export function UserAvatar({
  src,
  alt = '',
  className = 'object-cover',
  sizes = '40px',
}: UserAvatarProps) {
  if (requiresSessionCookieImage(src)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- /api/files exige sessão; otimizador do Next não envia cookies
      <img src={src} alt={alt} className={`absolute inset-0 h-full w-full ${className}`} />
    );
  }

  return <Image src={src} alt={alt} fill sizes={sizes} className={className} />;
}
