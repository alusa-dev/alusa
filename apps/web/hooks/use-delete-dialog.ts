import { useCallback, useEffect, useMemo, useState } from 'react';

export interface UseDeleteDialogOptions<T> {
  /** Callback executado ao confirmar a exclusão */
  onDelete?: (_entity: T, _reason: string) => Promise<void> | void;
  /** Valor padrão do motivo */
  initialReason?: string;
}

interface DeleteDialogState<T> {
  open: boolean;
  entity: T | null;
  reason: string;
  loading: boolean;
}

const CLOSED_STATE = { open: false, entity: null, reason: '', loading: false } as const;

export function useDeleteDialog<T>({ onDelete, initialReason }: UseDeleteDialogOptions<T> = {}) {
  const initialReasonValue = useMemo(() => initialReason ?? '', [initialReason]);
  const [state, setState] = useState<DeleteDialogState<T>>({
    ...CLOSED_STATE,
    reason: initialReasonValue,
  });

  useEffect(() => {
    setState((prev) =>
      prev.open
        ? prev
        : {
            ...prev,
            reason: initialReasonValue,
          },
    );
  }, [initialReasonValue]);

  const openDialog = useCallback(
    (entity: T) => {
      setState({
        open: true,
        entity,
        reason: initialReasonValue,
        loading: false,
      });
    },
    [initialReasonValue],
  );

  const resetState = useCallback(() => {
    setState({
      ...CLOSED_STATE,
      reason: initialReasonValue,
    });
  }, [initialReasonValue]);

  const setReason = useCallback((value: string) => {
    setState((prev) => ({ ...prev, reason: value }));
  }, []);

  const closeDialog = useCallback(() => {
    resetState();
  }, [resetState]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetState();
      else setState((prev) => ({ ...prev, open }));
    },
    [resetState],
  );

  const confirm = useCallback(async () => {
    if (!state.entity || state.loading) return;
    try {
      setState((prev) => ({ ...prev, loading: true }));
      await onDelete?.(state.entity, state.reason.trim());
      resetState();
    } catch (error) {
      // Mantém o diálogo aberto para permitir nova tentativa
      setState((prev) => ({ ...prev, loading: false }));
      throw error;
    }
  }, [state.entity, state.loading, state.reason, onDelete, resetState]);

  return {
    open: state.open,
    loading: state.loading,
    reason: state.reason,
    entity: state.entity,
    openDialog,
    closeDialog,
    setReason,
    confirm,
    onOpenChange: handleOpenChange,
  };
}

export type UseDeleteDialogReturn<T> = ReturnType<typeof useDeleteDialog<T>>;
