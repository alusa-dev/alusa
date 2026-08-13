"use client";
import type { ReactNode } from 'react';
import { logoutCurrentSession } from '@/lib/client/logout';
import { X } from '@/components/icons/icons';

interface Props {
  children: ReactNode;
  bgClassName?: string; // mantido por compatibilidade
  showClose?: boolean;
}

export default function AuthPageContainer({ children, showClose }: Props) {
  return (
    <div className="relative">
      {showClose && (
        <button
          aria-label="Sair e retornar ao login"
          title="Sair"
          onClick={() => void logoutCurrentSession('/auth/login')}
          className="absolute top-6 right-6 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-white"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      {children}
    </div>
  );
}
