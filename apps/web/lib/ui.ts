// utilidades UI reutilizáveis
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// declaração mínima para satisfazer linter mesmo sem tipos instalados
type TwMergeFn = (cls: string) => string;
const tw: TwMergeFn = (twMerge as unknown as TwMergeFn);

export function cn(...inputs: ClassValue[]): string {
  // por quê: centraliza merge de classes evitando conflitos Tailwind e duplicações
  return tw(clsx(inputs));
}
