'use client';

import { useEffect, useId, type ReactNode } from 'react';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/button';

export function SupportActionModal({
  title,
  description,
  confirmLabel,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
  disabled = false,
  children,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  reason: string;
  onReasonChange: (_value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !disabled) onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [disabled, onClose]);

  return (
    <div
      className="support-action-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !disabled) onClose();
      }}
    >
      <section
        className="support-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="support-action-modal-header">
          <div>
            <p className="support-action-modal-kicker">Ação da integração</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="support-action-modal-close"
            aria-label="Fechar"
            onClick={onClose}
            disabled={disabled}
          >
            <Icon name="XMark" size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="support-action-modal-body">
          <p id={descriptionId} className="support-action-modal-description">
            {description}
          </p>
          {children}
          <label className="support-action-modal-field">
            <span>Motivo da ação</span>
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Ex.: Recuperação solicitada pelo suporte após falha de autenticação."
              rows={3}
              maxLength={500}
              disabled={disabled}
            />
            <small>Obrigatório, mínimo de 8 caracteres.</small>
          </label>
        </div>

        <footer className="support-action-modal-footer">
          <Button type="button" variant="outline" onClick={onClose} disabled={disabled}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirm} disabled={disabled || reason.trim().length < 8}>
            {disabled ? 'Processando…' : confirmLabel}
          </Button>
        </footer>
      </section>
    </div>
  );
}
