'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface QuickFilterOption<T extends string = string> {
  label: string;
  value: T;
}

export interface QuickFilterTabsProps<T extends string = string> {
  /** Currently selected filter value */
  value: T;
  /** Callback when filter changes */
  onValueChange: (value: T) => void;
  /** Available filter options */
  options: QuickFilterOption<T>[];
  /** Optional className for the wrapper */
  className?: string;
  /** Accessible label for the toggle group */
  ariaLabel?: string;
}

/**
 * Reusable quick filter tabs component.
 * Provides a consistent UI for filtering lists by predefined categories.
 *
 * @example
 * ```tsx
 * <QuickFilterTabs
 *   value={filter}
 *   onValueChange={setFilter}
 *   options={[
 *     { label: 'Todos', value: 'TODOS' },
 *     { label: 'Prontos', value: 'PRONTO' },
 *     { label: 'Aguardando', value: 'AGUARDANDO' },
 *   ]}
 * />
 * ```
 */
export function QuickFilterTabs<T extends string = string>({
  value,
  onValueChange,
  options,
  className = '',
  ariaLabel = 'Filtros rápidos',
}: QuickFilterTabsProps<T>) {
  return (
    <ToggleGroup
      value={value}
      onValueChange={(v) => onValueChange((v || options[0]?.value) as T)}
      className={className}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default QuickFilterTabs;
