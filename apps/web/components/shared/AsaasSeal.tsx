'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme/ThemeProvider';

type AsaasSealVariant = 'positivo' | 'negativo-preto' | 'negativo-branco';

const SEAL_URLS: Record<AsaasSealVariant, string> = {
  'positivo':
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
  'negativo-preto':
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Preto.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
  'negativo-branco':
    'https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Branco.svg?id=6f5854f6-5cec-44e0-b517-6bdc1757216e',
};

interface AsaasSealProps {
  variant?: AsaasSealVariant;
  darkVariant?: AsaasSealVariant;
  className?: string;
}

export function AsaasSeal({ variant = 'positivo', darkVariant, className }: AsaasSealProps) {
  const { resolvedTheme } = useTheme();
  const isDarkResolved = resolvedTheme === 'dark';
  const resolvedVariant = isDarkResolved ? (darkVariant ?? (variant === 'negativo-preto' ? 'negativo-branco' : variant)) : variant;

  return (
    <a
      href="https://asaas.com"
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex', className)}
      aria-label="Serviços financeiros Asaas"
    >
      <img
        src={SEAL_URLS[resolvedVariant]}
        alt="Serviços financeiros Asaas"
        width={160}
        height={48}
      />
    </a>
  );
}
