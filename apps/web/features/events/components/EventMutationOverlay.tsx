import { LoadingDots } from '@/components/ui/LoadingDots';

export function EventMutationOverlay({ pending, label }: { pending: boolean; label: string }) {
  if (!pending) return null;

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/15" aria-busy="true">
      <LoadingDots label={label} />
    </div>
  );
}
