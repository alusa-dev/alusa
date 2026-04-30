import { useCallback, useState } from 'react';

export interface UseEditDialogOptions<T> {
  initialEntity?: T | null;
  keepEntityOnClose?: boolean;
}

export function useEditDialog<T>({
  initialEntity = null,
  keepEntityOnClose = false,
}: UseEditDialogOptions<T> = {}) {
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState<T | null>(initialEntity);

  const openDialog = useCallback((value: T) => {
    setEntity(value);
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    if (!keepEntityOnClose) setEntity(null);
  }, [keepEntityOnClose]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        closeDialog();
      } else {
        setOpen(true);
      }
    },
    [closeDialog],
  );

  return {
    open,
    entity,
    setEntity,
    openDialog,
    closeDialog,
    onOpenChange,
  };
}

export type UseEditDialogReturn<T> = ReturnType<typeof useEditDialog<T>>;
