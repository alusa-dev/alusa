import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { cn } from '@/features/site/lib/cn';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return <BrandWordmark variant="white" className={cn('h-8', className)} />;
}
