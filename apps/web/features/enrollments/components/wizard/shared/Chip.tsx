import { XMarkIcon } from '@heroicons/react/24/outline';

export interface ChipProps {
  label: string;
  onRemove?: () => void;
  removable?: boolean;
  className?: string;
  title?: string;
  color?: 'primary' | 'default';
}

// Utiliza tokens tailwind (bg-primary etc.) quando color="primary"
export function Chip({
  label,
  onRemove,
  removable = true,
  className = '',
  title,
  color = 'primary',
}: ChipProps) {
  const base =
    color === 'primary'
      ? 'border border-primary bg-primary/10 text-primary'
      : 'border border-slate-300 bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${base} ${className}`}
      title={title || label}
      data-chip="true"
    >
      {label}
      {removable && onRemove && (
        <button
          type="button"
          aria-label={`Remover ${label}`}
          onClick={onRemove}
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
