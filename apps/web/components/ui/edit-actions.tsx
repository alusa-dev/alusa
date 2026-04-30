"use client";

import { Button } from "./button";

type Props = {
  isEditing: boolean;
  isSaving?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  saveDisabled?: boolean;
};

export function EditActions({ isEditing, isSaving, onEdit, onCancel, onSave, saveDisabled }: Props) {
  return isEditing ? (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={onCancel} disabled={isSaving} aria-busy={isSaving}>
        Cancelar
      </Button>
      <Button size="sm" onClick={onSave} disabled={Boolean(isSaving) || Boolean(saveDisabled)} aria-busy={isSaving}>
        {isSaving ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="outline" onClick={onEdit}>
      Editar
    </Button>
  );
}

