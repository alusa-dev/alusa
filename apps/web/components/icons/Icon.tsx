import React from 'react';
import * as Icons from './icons';

// Tipagem: nomes das exports do alias
export type IconName = keyof typeof Icons;

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  className?: string;
}

/**
 * Componente genérico de ícone.
 * Vantagens:
 * - Centraliza controle de tamanho/padrões.
 * - Facilita futura troca por lazy loading ou sprites.
 * - Evita imports diretos repetidos.
 */
type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;
const registry: Record<string, IconComponent> = Icons as unknown as Record<string, IconComponent>;

export const Icon: React.FC<IconProps> = ({ name, size = 16, className = '', ...rest }) => {
  const Cmp = registry[name];
  if (!Cmp) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] ícone não encontrado: ${name}`);
    }
    return null;
  }
  return <Cmp width={size} height={size} aria-hidden="true" className={className} {...rest} />;
};
