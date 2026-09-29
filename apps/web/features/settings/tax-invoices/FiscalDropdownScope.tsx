'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type FiscalDropdownScopeContextValue = {
  activeId: string | null;
  openDropdown: (id: string) => void;
  closeDropdown: (id: string) => void;
};

const FiscalDropdownScopeContext = createContext<FiscalDropdownScopeContextValue | null>(null);

export function FiscalDropdownScope({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const openDropdown = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const closeDropdown = useCallback((id: string) => {
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const value = useMemo(
    () => ({ activeId, openDropdown, closeDropdown }),
    [activeId, openDropdown, closeDropdown],
  );

  return (
    <FiscalDropdownScopeContext.Provider value={value}>{children}</FiscalDropdownScopeContext.Provider>
  );
}

export function useFiscalDropdownControl(dropdownId: string) {
  const scope = useContext(FiscalDropdownScopeContext);
  const [localOpen, setLocalOpen] = useState(false);

  const open = scope ? scope.activeId === dropdownId : localOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (scope) {
        if (next) scope.openDropdown(dropdownId);
        else scope.closeDropdown(dropdownId);
        return;
      }
      setLocalOpen(next);
    },
    [scope, dropdownId],
  );

  return { open, setOpen };
}
