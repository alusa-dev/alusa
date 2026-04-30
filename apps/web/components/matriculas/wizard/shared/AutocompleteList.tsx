import { useEffect, useRef } from 'react';

export interface AutocompleteOption {
  value: string;
  label: string;
  description?: string;
  meta?: string;
}

interface AutocompleteListProps {
  id: string;
  options: AutocompleteOption[];
  highlightedIndex: number;
  selectedValue?: string;
  onSelect: (_opt: AutocompleteOption) => void;
  maxHeightClass?: string;
  renderDescription?: (_opt: AutocompleteOption) => string | undefined;
  className?: string;
}

export function AutocompleteList({
  id,
  options,
  highlightedIndex,
  selectedValue,
  onSelect,
  maxHeightClass = 'max-h-60',
  renderDescription,
  className = '',
}: AutocompleteListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Garantir que o item destacado fique visível
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  return (
    <div
      id={id}
      role="listbox"
      aria-activedescendant={highlightedIndex >= 0 ? `${id}-opt-${highlightedIndex}` : undefined}
      ref={listRef}
      className={`absolute z-40 mt-2 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg ${maxHeightClass} ${className}`}
    >
      {options.length === 0 && (
        <div className="select-none px-4 py-3 text-sm text-slate-500">Nenhum resultado</div>
      )}
      {options.map((o, idx) => {
        const isSelected = o.value === selectedValue;
        const isActive = idx === highlightedIndex;
        return (
          <button
            key={o.value}
            id={`${id}-opt-${idx}`}
            data-index={idx}
            role="option"
            aria-selected={isActive}
            type="button"
            data-selected={isSelected || undefined}
            data-state={isActive ? 'active' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(o);
            }}
            className="cursor-pointer w-full rounded-md px-3 py-2 text-left text-sm text-gray-900 transition focus:outline-none hover:bg-gray-50 data-[selected]:bg-gray-100 data-[selected]:text-gray-900 data-[state=active]:bg-gray-100 data-[state=active]:text-gray-900"
          >
            <div className="flex flex-col">
              <span className="font-medium text-gray-900">{o.label}</span>
              {renderDescription && (
                <span className="text-xs text-gray-500">
                  {renderDescription(o)}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
