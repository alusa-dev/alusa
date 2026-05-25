'use client';
import { getSeatGridCapacity, normalizeSeatGridConfig } from '@alusa/domain';
import type { SeatGridConfig } from '@alusa/domain';

import { useState } from 'react';

type CreateSeatGridDialogProps = {
  config: SeatGridConfig;
  onChange: (config: SeatGridConfig) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

function numberValue(value: string) {
  return value === '' ? 0 : Number(value);
}

export function CreateSeatGridDialog({ config, onChange, onCancel, onConfirm }: CreateSeatGridDialogProps) {
  const normalizedConfig = normalizeSeatGridConfig(config);
  const capacity = getSeatGridCapacity(normalizedConfig);
  const [desiredTotalSeats, setDesiredTotalSeats] = useState(normalizedConfig.totalSeats);

  function updateConfig(patch: Partial<SeatGridConfig>) {
    if ('totalSeats' in patch) {
      const desired = Math.max(1, patch.totalSeats ?? 1);
      setDesiredTotalSeats(desired);
      // Auto-expand rows when totalSeats exceeds current columns * rows
      const currentColumns = normalizedConfig.columns;
      const neededRows = Math.ceil(desired / currentColumns);
      const newRows = Math.max(normalizedConfig.rows, neededRows);
      onChange(normalizeSeatGridConfig({ ...normalizedConfig, rows: newRows, totalSeats: desired }));
    } else {
      const next = normalizeSeatGridConfig({ ...normalizedConfig, ...patch });
      const newCapacity = getSeatGridCapacity(next);
      const recoveredTotalSeats = Math.min(desiredTotalSeats, newCapacity);
      onChange(normalizeSeatGridConfig({ ...next, totalSeats: recoveredTotalSeats }));
    }
  }

  return (
    <div
      data-testid="seat-grid-dialog"
      className="absolute right-6 top-6 z-40 w-[360px] rounded-lg border border-slate-200 bg-white shadow-xl"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-950">Organizar assentos</h2>
        <p className="mt-1 text-xs text-slate-500">Ajuste a grade e confira a prévia na prancheta.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <label className="space-y-1 text-xs font-medium text-slate-600">
          Assentos
          <input
            data-testid="seat-grid-total-seats"
            type="number"
            min={1}
            max={50 * normalizedConfig.columns}
            value={normalizedConfig.totalSeats}
            onChange={(event) => updateConfig({ totalSeats: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Tamanho
          <input
            data-testid="seat-grid-seat-size"
            type="number"
            min={12}
            max={80}
            value={normalizedConfig.seatSize}
            onChange={(event) => updateConfig({ seatSize: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Linhas
          <input
            data-testid="seat-grid-rows"
            type="number"
            min={1}
            max={50}
            value={normalizedConfig.rows}
            onChange={(event) => updateConfig({ rows: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Colunas
          <input
            data-testid="seat-grid-columns"
            type="number"
            min={1}
            max={80}
            value={normalizedConfig.columns}
            onChange={(event) => updateConfig({ columns: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Espaço horizontal
          <input
            data-testid="seat-grid-horizontal-spacing"
            type="number"
            min={12}
            max={200}
            value={normalizedConfig.horizontalSpacing}
            onChange={(event) => updateConfig({ horizontalSpacing: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Espaço vertical
          <input
            data-testid="seat-grid-vertical-spacing"
            type="number"
            min={12}
            max={200}
            value={normalizedConfig.verticalSpacing}
            onChange={(event) => updateConfig({ verticalSpacing: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Linha inicial
          <input
            value={normalizedConfig.rowPrefix}
            maxLength={4}
            onChange={(event) => updateConfig({ rowPrefix: event.target.value })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="space-y-1 text-xs font-medium text-slate-600">
          Número inicial
          <input
            type="number"
            min={1}
            max={9999}
            value={normalizedConfig.startNumber}
            onChange={(event) => updateConfig({ startNumber: numberValue(event.target.value) })}
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          />
        </label>

        <label className="col-span-2 space-y-1 text-xs font-medium text-slate-600">
          Direção da numeração
          <select
            value={normalizedConfig.numberingDirection}
            onChange={(event) =>
              updateConfig({
                numberingDirection: event.target.value === 'right-to-left' ? 'right-to-left' : 'left-to-right',
              })
            }
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-950 outline-none focus:border-violet-500"
          >
            <option value="left-to-right">Esquerda para direita</option>
            <option value="right-to-left">Direita para esquerda</option>
          </select>
        </label>
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Prévia com {normalizedConfig.totalSeats} assentos em até {capacity} posições.
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="seat-grid-submit"
            onClick={onConfirm}
            className="h-9 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white hover:bg-violet-800"
          >
            Criar assentos
          </button>
        </div>
      </div>
    </div>
  );
}
