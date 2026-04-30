'use client';

import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
} from 'react';

// --- Styles ---
// Using a style tag for the ::before pseudo-element since it can't be done inline
const segmentedControlStyles = `
.segmented-control-container {
  --highlight-width: 0px;
  --highlight-x-pos: 0px;
  display: inline-flex;
  position: relative;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 4px;
}

.segmented-control-container::before {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  z-index: 0;
  background: #5c2f91;
  border-radius: 6px;
  width: var(--highlight-width);
  transform: translateX(var(--highlight-x-pos));
  transition: transform 0.3s ease, width 0.3s ease;
}

.segmented-control-item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  min-height: 32px;
  font-size: 14px;
  white-space: nowrap;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s ease;
  background: transparent;
  border: none;
  outline: none;
}

.segmented-control-item:focus-visible {
  box-shadow: 0 0 0 2px rgba(79, 34, 152, 0.4);
}

.segmented-control-item[data-active="true"] {
  color: #ffffff;
  font-weight: 600;
}

.segmented-control-item[data-active="false"] {
  color: #6B7280;
  font-weight: 500;
}

.segmented-control-item[data-active="false"]:hover {
  color: #374151;
}

.segmented-control-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;

// Inject styles once
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  const styleEl = document.createElement('style');
  styleEl.textContent = segmentedControlStyles;
  document.head.appendChild(styleEl);
  stylesInjected = true;
}

// --- Context ---
interface ToggleGroupContextValue {
  value: string;
  setValue: (value: string) => void;
}

const ToggleGroupCtx = createContext<ToggleGroupContextValue | null>(null);

// --- Component: ToggleGroup ---
interface ToggleGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  options?: { label: string; value: string }[];
  children?: React.ReactNode;
  className?: string;
}

export function ToggleGroup({
  value,
  onValueChange,
  options,
  children,
  className = '',
}: ToggleGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Inject styles on mount
  useEffect(() => {
    injectStyles();
    setIsReady(true);
  }, []);

  // Update CSS variables when value changes
  useLayoutEffect(() => {
    if (!containerRef.current || !isReady) return;

    const activeElement = itemRefs.current.get(value);
    if (!activeElement) return;

    const { offsetWidth, offsetLeft } = activeElement;
    containerRef.current.style.setProperty('--highlight-width', `${offsetWidth}px`);
    containerRef.current.style.setProperty('--highlight-x-pos', `${offsetLeft}px`);
  }, [value, isReady]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const updatePosition = () => {
      const activeElement = itemRefs.current.get(value);
      if (!activeElement || !containerRef.current) return;

      const { offsetWidth, offsetLeft } = activeElement;
      containerRef.current.style.setProperty('--highlight-width', `${offsetWidth}px`);
      containerRef.current.style.setProperty('--highlight-x-pos', `${offsetLeft}px`);
    };

    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [value]);

  const registerRef = (itemValue: string, element: HTMLButtonElement | null) => {
    if (element) {
      itemRefs.current.set(itemValue, element);
    } else {
      itemRefs.current.delete(itemValue);
    }
  };

  const safeOptions = Array.isArray(options) ? options : [];

  return (
    <ToggleGroupCtx.Provider value={{ value, setValue: onValueChange }}>
      <div
        ref={containerRef}
        role="tablist"
        className={`segmented-control-container ${className}`}
      >
        {safeOptions.length > 0
          ? safeOptions.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              ref={(el) => registerRef(opt.value, el)}
            >
              {opt.label}
            </ToggleGroupItem>
          ))
          : React.Children.map(children, (child) => {
            if (!React.isValidElement<ToggleGroupItemProps>(child)) return child;

            const { value: childValue, ...childProps } = child.props;
            return (
              <ToggleGroupItem
                key={(child.key as string | null) ?? childValue}
                value={childValue}
                ref={(el) => registerRef(childValue, el)}
                {...childProps}
              />
            );
          })}
      </div>
    </ToggleGroupCtx.Provider>
  );
}

// --- Component: ToggleGroupItem ---
export interface ToggleGroupItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ value, className = '', disabled, children, ...rest }, ref) => {
    const ctx = useContext(ToggleGroupCtx);
    const internalRef = useRef<HTMLButtonElement>(null);

    // Use forwarded ref or internal ref
    const buttonRef = (ref as React.RefObject<HTMLButtonElement>) || internalRef;

    if (!ctx) {
      throw new Error('ToggleGroupItem must be used within <ToggleGroup>');
    }

    const isActive = ctx.value === value;

    return (
      <button
        ref={buttonRef}
        type="button"
        role="tab"
        aria-selected={isActive}
        disabled={disabled}
        data-active={isActive}
        data-value={value}
        onClick={() => {
          if (!disabled && !isActive) {
            ctx.setValue(value);
          }
        }}
        className={`segmented-control-item ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

ToggleGroupItem.displayName = 'ToggleGroupItem';
