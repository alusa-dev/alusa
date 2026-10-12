'use client';

import { arcSweepDegrees, createArcPathFromChord, pointAtDistance, pathLength, resolveSeatCountForRow, setArcSweep } from '@alusa/domain';
import type { EventMapDTO, MapSeatBlock, MapSeatRow, MapSection, SeatDistributionAlignment, SeatDistributionMode, SeatRowPath } from '@alusa/domain';
import { CreatorIcon } from '@/components/icons/hugeicons';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAP_PANEL_FIELD_CLASS,
  MAP_PANEL_SECTION_CLASS,
  MAP_PANEL_SECTION_TITLE_CLASS,
  MAP_PANEL_SELECT_TRIGGER_CLASS,
} from './text-format-options';
import { MapPanelSelect } from './MapPanelSelect';
import { MAP_FLOATING_SHADOW_CLASS } from './map-toolbar-styles';
import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PARAMETRIC_FIELD_CLASS = cn(
  MAP_PANEL_FIELD_CLASS,
  'border-transparent bg-neutral-100 px-2.5 text-[13px] focus-visible:border-neutral-300 focus-visible:bg-neutral-100 focus-visible:ring-0',
);
const PARAMETRIC_SELECT_CLASS = cn(
  MAP_PANEL_SELECT_TRIGGER_CLASS,
  'border-transparent bg-neutral-100 px-2.5 text-[13px] hover:border-transparent data-[state=open]:border-neutral-300 focus:ring-0 focus-visible:ring-0',
);

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn(MAP_PANEL_SECTION_CLASS, 'border-slate-100 p-3')}>
      <h3 className={MAP_PANEL_SECTION_TITLE_CLASS}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function QuantityStepper({
  label,
  value,
  unit,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const displayValue = Number.isFinite(value) ? Math.round(value) : min;

  return (
    <div className="flex h-9 items-center justify-between rounded-lg bg-neutral-100 px-1">
      <button
        type="button"
        aria-label={`Reduzir ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, displayValue - 1))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-neutral-200 hover:text-slate-950 disabled:pointer-events-none disabled:opacity-35"
      >
        <CreatorIcon name="minus" size={14} />
      </button>
      <span aria-live="polite" className="text-sm font-medium text-slate-800">
        {displayValue} {unit}
      </span>
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(max === undefined ? displayValue + 1 : Math.min(max, displayValue + 1))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-neutral-200 hover:text-slate-950 disabled:pointer-events-none disabled:opacity-35"
      >
        <CreatorIcon name="add" size={14} />
      </button>
    </div>
  );
}

function visibleSeatTotal(block: MapSeatBlock) {
  return block.rows.reduce(
    (total, row, rowIndex, rows) => total + resolveSeatCountForRow(block, row, rowIndex, rows.length),
    0,
  );
}

function blockColumnCount(block: MapSeatBlock) {
  return Math.max(1, Math.round(block.columnCount ?? Math.max(...block.rows.map((row) => row.seats.length), 1)));
}

function sequentialRowCounts(total: number, capacities: number[]) {
  let remaining = Math.max(0, total);
  const counts = capacities.map((capacity) => {
    const count = Math.min(Math.max(0, capacity), remaining);
    remaining -= count;
    return count;
  });
  return counts;
}

function updateBlockColumns(
  block: MapSeatBlock,
  seatTotal: number,
  nextColumns: number,
  onUpdateBlock: ParametricSeatPropertiesProps['onUpdateBlock'],
) {
  const mode = block.distributionMode ?? 'FIXED';
  if (mode === 'FIXED') {
    const counts = sequentialRowCounts(Math.min(seatTotal, block.rows.length * nextColumns), block.rows.map(() => nextColumns));
    onUpdateBlock(block.id, {
      columnCount: nextColumns,
      rowSeatCounts: counts,
      distribution: [{ type: 'SEATS', count: Math.max(...counts, 0) }],
      distributionMode: 'FIXED',
    });
  } else if (mode === 'PROGRESSIVE') {
    onUpdateBlock(block.id, {
      columnCount: nextColumns,
      firstRowSeatCount: Math.min(block.firstRowSeatCount ?? nextColumns, nextColumns),
      lastRowSeatCount: Math.min(block.lastRowSeatCount ?? nextColumns, nextColumns),
    });
  } else {
    onUpdateBlock(block.id, {
      columnCount: nextColumns,
      fitMaximumSeatCount: Math.min(block.fitMaximumSeatCount ?? nextColumns, nextColumns),
    });
  }
}

function updateBlockSeatTotal(
  block: MapSeatBlock,
  total: number,
  onUpdateBlock: ParametricSeatPropertiesProps['onUpdateBlock'],
) {
  const nextColumns = blockColumnCount(block);
  const rowCount = Math.max(1, Math.ceil(total / nextColumns));
  const counts = sequentialRowCounts(total, Array.from({ length: rowCount }, () => nextColumns));
  onUpdateBlock(block.id, {
    rowSeatCounts: counts,
    distributionMode: 'FIXED',
  });
}

function pathType(path: SeatRowPath) {
  return path.type;
}

function pathEndpoints(path: SeatRowPath) {
  if (path.type === 'LINE') return { start: path.start, end: path.end };
  if (path.type === 'ARC') {
    const length = pathLength(path);
    return { start: pointAtDistance(path, 0).point, end: pointAtDistance(path, length).point };
  }
  if (path.type === 'POLYLINE') return { start: path.points[0]!, end: path.points.at(-1)! };
  return { start: path.p0, end: path.p3 };
}

function pathWithType(row: MapSeatRow, type: SeatRowPath['type']): SeatRowPath {
  if (type === row.path.type) return row.path;
  if (type === 'LINE') {
    const { start, end } = pathEndpoints(row.path);
    return { type: 'LINE', start, end };
  }
  if (type === 'ARC') {
    const { start, end } = pathEndpoints(row.path);
    return createArcPathFromChord(start, end, 60);
  }
  if (type === 'POLYLINE') {
    const { start, end } = pathEndpoints(row.path);
    return { type: 'POLYLINE', points: [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 24 }, end] };
  }
  const { start, end } = pathEndpoints(row.path);
  return {
    type: 'BEZIER',
    p0: start,
    p1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 - 24 },
    p2: { x: start.x + ((end.x - start.x) * 2) / 3, y: start.y + ((end.y - start.y) * 2) / 3 - 24 },
    p3: end,
  };
}

function pathsForBlock(block: MapSeatBlock, type: SeatRowPath['type'], sweep = 60, clockwise = true) {
  return block.rows.map((row) => {
    if (type !== 'ARC') return pathWithType(row, type);
    return row.path.type === 'ARC'
      ? setArcSweep(row.path, sweep, clockwise)
      : createArcPathFromChord(pathEndpoints(row.path).start, pathEndpoints(row.path).end, sweep, clockwise);
  });
}

type ParametricSeatPropertiesProps = {
  section: MapSection;
  block: MapSeatBlock | null;
  row: MapSeatRow | null;
  disabled?: boolean;
  numberingLocked?: boolean;
  status: EventMapDTO['status'];
  onUpdateBlock: (id: string, patch: Partial<Pick<MapSeatBlock, 'name' | 'columnCount' | 'rowGap' | 'defaultSeatGap' | 'distribution' | 'distributionMode' | 'distributionAlignment' | 'firstRowSeatCount' | 'lastRowSeatCount' | 'fitMinimumSeatCount' | 'fitMaximumSeatCount' | 'numberingMode'>> & { seatSize?: number; rowSeatCounts?: number[]; rowPaths?: SeatRowPath[] }) => void;
  onUpdateRow: (id: string, patch: Partial<Pick<MapSeatRow, 'path' | 'seatGap' | 'seatSize'>>) => void;
};

export function ParametricSeatProperties({ section, block, row, disabled, numberingLocked, status, onUpdateBlock, onUpdateRow }: ParametricSeatPropertiesProps) {
  const [pendingNumberingMode, setPendingNumberingMode] = useState<MapSeatBlock['numberingMode'] | null>(null);
  if (!block && !row) return null;
  const activeBlock = block ?? (row ? section.blocks.find((candidate) => candidate.id === row.blockId) ?? null : null);
  if (!activeBlock) return null;
  const seatTotal = visibleSeatTotal(activeBlock);
  const allRowsAreArcs = activeBlock.rows.length > 0 && activeBlock.rows.every((candidate) => candidate.path.type === 'ARC');
  const blockPathType = activeBlock.rows.every((candidate) => candidate.path.type === activeBlock.rows[0]?.path.type)
    ? activeBlock.rows[0]?.path.type ?? 'LINE'
    : 'MIXED';
  const blockArcSweep = allRowsAreArcs
    ? Math.round(activeBlock.rows.reduce((total, candidate) => total + (candidate.path.type === 'ARC' ? arcSweepDegrees(candidate.path) : 0), 0) / activeBlock.rows.length)
    : 60;
  const blockArcDirection = activeBlock.rows[0]?.path.type === 'ARC' ? activeBlock.rows[0].path.clockwise : true;

  return (
    <>
      <PanelSection title="Identificação e capacidade">
        <PanelField label="Nome do bloco">
          <Input
            value={activeBlock.name ?? ''}
            disabled={disabled}
            placeholder="Ex.: Plateia central"
            onChange={(event) => onUpdateBlock(activeBlock.id, { name: event.target.value || null })}
            className={PARAMETRIC_FIELD_CLASS}
          />
        </PanelField>
        <PanelField label="Numeração dos assentos">
          <MapPanelSelect
            className={PARAMETRIC_SELECT_CLASS}
            value={activeBlock.numberingMode ?? 'ALPHANUMERIC'}
            disabled={disabled || numberingLocked}
            options={[
              { value: 'ALPHANUMERIC', label: 'Alfanumérica (A1, A2...)' },
              { value: 'NUMERIC', label: 'Numérica (1, 2, 3...)' },
            ]}
            onValueChange={(value) => {
              const numberingMode = value as MapSeatBlock['numberingMode'];
              if (status === 'PUBLISHED') setPendingNumberingMode(numberingMode);
              else onUpdateBlock(activeBlock.id, { numberingMode });
            }}
          />
          {numberingLocked ? <p className="text-xs text-amber-700">A numeração fica bloqueada enquanto houver assentos reservados, vendidos ou cortesia neste bloco.</p> : null}
        </PanelField>
        <PanelField label="Colunas">
          <QuantityStepper
            label="colunas"
            value={blockColumnCount(activeBlock)}
            unit={blockColumnCount(activeBlock) === 1 ? 'coluna' : 'colunas'}
            min={1}
            disabled={disabled}
            onChange={(value) => updateBlockColumns(activeBlock, seatTotal, value, onUpdateBlock)}
          />
        </PanelField>
        {(activeBlock.distributionMode ?? 'FIXED') === 'FIXED' ? (
          <PanelField label="Total de assentos">
            <QuantityStepper
              label="total de assentos"
              value={seatTotal}
              unit={seatTotal === 1 ? 'assento' : 'assentos'}
              min={1}
              disabled={disabled}
              onChange={(value) => updateBlockSeatTotal(activeBlock, value, onUpdateBlock)}
            />
          </PanelField>
        ) : null}
        <div className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-slate-600">
          {activeBlock.rows.length} fileiras · {seatTotal} {seatTotal === 1 ? 'assento' : 'assentos'}
        </div>
      </PanelSection>

      <PanelSection title="Geometria e espaçamento">
        {!row ? (
          <>
            <PanelField label="Forma das fileiras">
              <MapPanelSelect
                className={PARAMETRIC_SELECT_CLASS}
                value={blockPathType}
                disabled={disabled}
                options={[
                  ...(blockPathType === 'MIXED' ? [{ value: 'MIXED', label: 'Mista — escolha para aplicar a todas' }] : []),
                  { value: 'LINE', label: 'Reta' },
                  { value: 'ARC', label: 'Curva / arco' },
                  { value: 'POLYLINE', label: 'Segmentada' },
                  { value: 'BEZIER', label: 'Bezier' },
                ]}
                onValueChange={(value) => {
                  if (value === 'MIXED') return;
                  onUpdateBlock(activeBlock.id, { rowPaths: pathsForBlock(activeBlock, value as SeatRowPath['type']) });
                }}
              />
            </PanelField>
            {allRowsAreArcs ? (
              <>
                <PanelField label={`Curvatura · ${blockArcSweep}°`}>
                  <input
                    aria-label="Curvatura de todas as fileiras"
                    type="range"
                    min={5}
                    max={170}
                    step={1}
                    value={blockArcSweep}
                    disabled={disabled}
                    onChange={(event) => onUpdateBlock(activeBlock.id, {
                      rowPaths: pathsForBlock(activeBlock, 'ARC', toNumber(event.target.value, 60), blockArcDirection),
                    })}
                    className="h-2 w-full cursor-pointer accent-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </PanelField>
                <PanelField label="Direção da curva">
                  <MapPanelSelect
                    className={PARAMETRIC_SELECT_CLASS}
                    value={blockArcDirection ? 'DOWN' : 'UP'}
                    disabled={disabled}
                    options={[
                      { value: 'UP', label: 'Curvar para cima' },
                      { value: 'DOWN', label: 'Curvar para baixo' },
                    ]}
                    onValueChange={(value) => onUpdateBlock(activeBlock.id, {
                      rowPaths: pathsForBlock(activeBlock, 'ARC', blockArcSweep, value === 'DOWN'),
                    })}
                  />
                </PanelField>
              </>
            ) : null}
          </>
        ) : null}
        <div className="space-y-3">
          <PanelField label={row ? 'Tamanho do assento' : 'Tamanho dos assentos'}>
            <QuantityStepper
              label="tamanho dos assentos"
              value={row?.seatSize ?? activeBlock.rows[0]?.seatSize ?? 24}
              unit="px"
              min={8}
              max={120}
              disabled={disabled}
              onChange={(size) => {
                if (row) onUpdateRow(row.id, { seatSize: size });
                else onUpdateBlock(activeBlock.id, { seatSize: size });
              }}
            />
          </PanelField>
          <PanelField label="Espaço entre fileiras">
            <QuantityStepper
              label="espaço entre fileiras"
              value={activeBlock.rowGap}
              unit="px"
              min={0}
              max={1000}
              disabled={disabled}
              onChange={(rowGap) => onUpdateBlock(activeBlock.id, { rowGap })}
            />
          </PanelField>
          <PanelField label="Espaço entre assentos">
            <QuantityStepper
              label="espaço entre assentos"
              value={activeBlock.defaultSeatGap}
              unit="px"
              min={0}
              max={1000}
              disabled={disabled}
              onChange={(defaultSeatGap) => onUpdateBlock(activeBlock.id, { defaultSeatGap })}
            />
          </PanelField>
        </div>
      </PanelSection>

      <PanelSection title="Distribuição dos assentos">
        <PanelField label="Distribuição">
          <MapPanelSelect
            className={PARAMETRIC_SELECT_CLASS}
            value={activeBlock.distributionMode ?? 'FIXED'}
            disabled={disabled}
            options={[
              { value: 'FIXED', label: 'Igual em todas as fileiras' },
              { value: 'PROGRESSIVE', label: 'Progressiva' },
              { value: 'FIT', label: 'Ajustar ao espaço' },
            ]}
            onValueChange={(value) => onUpdateBlock(activeBlock.id, { distributionMode: value as SeatDistributionMode })}
          />
        </PanelField>
        {(activeBlock.distributionMode ?? 'FIXED') === 'PROGRESSIVE' ? (
          <>
            <div className="space-y-3">
            <PanelField label="Primeira fileira">
              <QuantityStepper
                label="assentos na primeira fileira"
                value={activeBlock.firstRowSeatCount ?? activeBlock.rows[0]?.seats.length ?? 0}
                unit="assentos"
                min={0}
                max={blockColumnCount(activeBlock)}
                disabled={disabled}
                onChange={(firstRowSeatCount) => onUpdateBlock(activeBlock.id, { firstRowSeatCount })}
              />
            </PanelField>
            <PanelField label="Última fileira">
              <QuantityStepper
                label="assentos na última fileira"
                value={activeBlock.lastRowSeatCount ?? activeBlock.rows.at(-1)?.seats.length ?? 0}
                unit="assentos"
                min={0}
                max={blockColumnCount(activeBlock)}
                disabled={disabled}
                onChange={(lastRowSeatCount) => onUpdateBlock(activeBlock.id, { lastRowSeatCount })}
              />
            </PanelField>
            </div>
            <PanelField label="Alinhamento da progressão">
              <MapPanelSelect
                className={PARAMETRIC_SELECT_CLASS}
                value={activeBlock.distributionAlignment ?? 'LEFT'}
                disabled={disabled}
                options={[
                  { value: 'LEFT', label: 'Alinhar à esquerda' },
                  { value: 'CENTER', label: 'Centralizar' },
                  { value: 'RIGHT', label: 'Alinhar à direita' },
                ]}
                onValueChange={(value) => onUpdateBlock(activeBlock.id, { distributionAlignment: value as SeatDistributionAlignment })}
              />
            </PanelField>
          </>
        ) : null}
        {(activeBlock.distributionMode ?? 'FIXED') === 'FIT' ? (
          <div className="space-y-3">
            <PanelField label="Mínimo">
              <QuantityStepper
                label="mínimo de assentos por fileira"
                value={activeBlock.fitMinimumSeatCount ?? 1}
                unit="assentos"
                min={0}
                max={activeBlock.fitMaximumSeatCount ?? blockColumnCount(activeBlock)}
                disabled={disabled}
                onChange={(fitMinimumSeatCount) => onUpdateBlock(activeBlock.id, { fitMinimumSeatCount })}
              />
            </PanelField>
            <PanelField label="Máximo">
              <QuantityStepper
                label="máximo de assentos por fileira"
                value={activeBlock.fitMaximumSeatCount ?? blockColumnCount(activeBlock)}
                unit="assentos"
                min={activeBlock.fitMinimumSeatCount ?? 0}
                max={blockColumnCount(activeBlock)}
                disabled={disabled}
                onChange={(fitMaximumSeatCount) => onUpdateBlock(activeBlock.id, { fitMaximumSeatCount })}
              />
            </PanelField>
          </div>
        ) : null}
      </PanelSection>

      {row ? (
        <PanelSection title={`Fileira ${row.label}`}>
          <PanelField label="Forma">
            <MapPanelSelect
              className={PARAMETRIC_SELECT_CLASS}
              value={pathType(row.path)}
              disabled={disabled}
              options={[
                { value: 'LINE', label: 'Reta' },
                { value: 'ARC', label: 'Curva / arco' },
                { value: 'POLYLINE', label: 'Segmentada' },
                { value: 'BEZIER', label: 'Bezier' },
              ]}
              onValueChange={(value) => onUpdateRow(row.id, { path: pathWithType(row, value as SeatRowPath['type']) })}
            />
          </PanelField>
          {row.path.type === 'ARC' ? (
            <>
              <PanelField label={`Curvatura · ${Math.round(arcSweepDegrees(row.path))}°`}>
                <input
                  aria-label="Curvatura da fileira"
                  type="range"
                  min={5}
                  max={170}
                  step={1}
                  value={Math.round(arcSweepDegrees(row.path))}
                  disabled={disabled}
                  onChange={(event) => onUpdateRow(row.id, { path: setArcSweep(row.path as Extract<SeatRowPath, { type: 'ARC' }>, toNumber(event.target.value, 60)) })}
                  className="h-2 w-full cursor-pointer accent-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </PanelField>
              <PanelField label="Direção da curva">
                <MapPanelSelect
                  className={PARAMETRIC_SELECT_CLASS}
                  value={row.path.clockwise ? 'DOWN' : 'UP'}
                  disabled={disabled}
                  options={[
                    { value: 'UP', label: 'Curvar para cima' },
                    { value: 'DOWN', label: 'Curvar para baixo' },
                  ]}
                  onValueChange={(value) => onUpdateRow(row.id, { path: setArcSweep(row.path as Extract<SeatRowPath, { type: 'ARC' }>, arcSweepDegrees(row.path as Extract<SeatRowPath, { type: 'ARC' }>), value === 'DOWN') })}
                />
              </PanelField>
            </>
          ) : null}
          <div className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-slate-600">
            O espaçamento dos assentos é calculado ao longo do comprimento da geometria. Corredores são intervalos de distribuição do bloco.
          </div>
        </PanelSection>
      ) : null}
      <AlertDialog open={pendingNumberingMode !== null} onOpenChange={(open) => !open && setPendingNumberingMode(null)}>
        <AlertDialogContent className={MAP_FLOATING_SHADOW_CLASS}>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar numeração de mapa publicado?</AlertDialogTitle>
            <AlertDialogDescription>
              A alteração troca as etiquetas e os códigos técnicos deste bloco. Assentos reservados ou vendidos ficam protegidos; confirme apenas se a nova numeração deve aparecer na próxima publicação do mapa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingNumberingMode) onUpdateBlock(activeBlock.id, { numberingMode: pendingNumberingMode });
              setPendingNumberingMode(null);
            }}>Alterar numeração</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
