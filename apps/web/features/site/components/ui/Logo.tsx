import { BrandWordmark, type BrandWordmarkVariant } from '@/components/brand/BrandWordmark';
import { cn } from '@/features/site/lib/cn';

interface LogoProps {
  className?: string;
  variant?: BrandWordmarkVariant;
}

export function Logo({ className, variant = 'white' }: LogoProps) {
  return <BrandWordmark variant={variant} className={cn('h-8', className)} />;
}
