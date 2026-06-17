'use client';

import type { SeatedSectorContext } from '@alusa/domain';
import type { TicketLotDTO } from '../../events-service';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  MAP_PANEL_FIELD_CLASS,
  MAP_PANEL_GRID_CLASS,
  MAP_PANEL_SECTION_CLASS,
  MAP_PANEL_SECTION_TITLE_CLASS,
} from './text-format-options';
import {
  MAP_PANEL_SELECT_NONE_VALUE,
  MapPanelSelect,
  mapNullableSelectChange,
  mapNullableSelectValue,
} from './MapPanelSelect';

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
    <section className={MAP_PANEL_SECTION_CLASS}>
      <h3 className={MAP_PANEL_SECTION_TITLE_CLASS}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

type SeatedSectorPropertiesProps = {
  context: SeatedSectorContext;
  lots: TicketLotDTO[];
  disabled?: boolean;
  onUpdateSection: (id: string, patch: { name?: string; color?: string; lotId?: string | null; capacity?: number | null }) => void;
  onUpdateSeatGroup: (
    id: string,
    patch: Partial<{
      name: string | null;
      rows: number;
      columns: number;
      seatWidth: number;
      seatHeight: number;
      gapX: number;
      gapY: number;
      x: number;
      y: number;
      rotation: number;
    }>,
  ) => void;
  onUpdateSectionObject: (id: string, patch: { label?: string }) => void;
  onRotateSeatGroup: (id: string, nextRotation: number, currentRotation: number) => void;
  onDeleteSection: (id: string) => void;
};

export function SeatedSectorProperties({
  context,
  lots,
  disabled,
  onUpdateSection,
  onUpdateSeatGroup,
  onUpdateSectionObject,
  onRotateSeatGroup,
  onDeleteSection,
}: SeatedSectorPropertiesProps) {
  const { section, seatGroup, sectionObjectId } = context;

  function syncSectionName(name: string) {
    onUpdateSection(section.id, { name });
    onUpdateSeatGroup(seatGroup.id, { name });
    if (sectionObjectId) onUpdateSectionObject(sectionObjectId, { label: name });
  }

  return (
    <>
      <PanelSection title="Setor">
        <PanelField label="Nome do setor">
          <Input
            value={section.name}
            disabled={disabled}
            onChange={(event) => syncSectionName(event.target.value)}
            className={MAP_PANEL_FIELD_CLASS}
          />
        </PanelField>
        <PanelField label="Lote vinculado">
          <MapPanelSelect
            value={mapNullableSelectValue(section.lotId)}
            disabled={disabled}
            placeholder="Sem lote"
            options={[
              { value: MAP_PANEL_SELECT_NONE_VALUE, label: 'Sem lote' },
              ...lots.map((lot) => ({ value: lot.id, label: lot.name })),
            ]}
            onValueChange={(value) => onUpdateSection(section.id, { lotId: mapNullableSelectChange(value) })}
          />
        </PanelField>
        <PanelField label="Capacidade">
          <Input
            type="number"
            min={0}
            value={section.capacity ?? ''}
            disabled={disabled}
            onChange={(event) =>
              onUpdateSection(section.id, { capacity: event.target.value ? Number(event.target.value) : null })
            }
            className={MAP_PANEL_FIELD_CLASS}
          />
        </PanelField>
      </PanelSection>

      <PanelSection title="Grade de assentos">
        <div className={MAP_PANEL_GRID_CLASS}>
          <PanelField label="Fileiras">
            <Input
              type="number"
              min={1}
              max={50}
              value={seatGroup.rows}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { rows: Math.max(1, toNumber(event.target.value, seatGroup.rows)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
          <PanelField label="Colunas">
            <Input
              type="number"
              min={1}
              max={80}
              value={seatGroup.columns}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { columns: Math.max(1, toNumber(event.target.value, seatGroup.columns)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
        </div>
      </PanelSection>

      <PanelSection title="Cadeira">
        <div className={MAP_PANEL_GRID_CLASS}>
          <PanelField label="Largura">
            <Input
              type="number"
              min={8}
              value={seatGroup.seatWidth}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { seatWidth: Math.max(8, toNumber(event.target.value, seatGroup.seatWidth)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
          <PanelField label="Altura">
            <Input
              type="number"
              min={8}
              value={seatGroup.seatHeight}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { seatHeight: Math.max(8, toNumber(event.target.value, seatGroup.seatHeight)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
        </div>
        <div className={MAP_PANEL_GRID_CLASS}>
          <PanelField label="Espaç. horizontal">
            <Input
              type="number"
              min={0}
              value={seatGroup.gapX}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { gapX: Math.max(0, toNumber(event.target.value, seatGroup.gapX)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
          <PanelField label="Espaç. vertical">
            <Input
              type="number"
              min={0}
              value={seatGroup.gapY}
              disabled={disabled}
              onChange={(event) =>
                onUpdateSeatGroup(seatGroup.id, { gapY: Math.max(0, toNumber(event.target.value, seatGroup.gapY)) })
              }
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
        </div>
      </PanelSection>

      <PanelSection title="Posição">
        <div className={MAP_PANEL_GRID_CLASS}>
          <PanelField label="X">
            <Input
              type="number"
              value={seatGroup.x}
              disabled={disabled}
              onChange={(event) => onUpdateSeatGroup(seatGroup.id, { x: toNumber(event.target.value, seatGroup.x) })}
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
          <PanelField label="Y">
            <Input
              type="number"
              value={seatGroup.y}
              disabled={disabled}
              onChange={(event) => onUpdateSeatGroup(seatGroup.id, { y: toNumber(event.target.value, seatGroup.y) })}
              className={MAP_PANEL_FIELD_CLASS}
            />
          </PanelField>
        </div>
        <PanelField label="Rotação">
          <Input
            type="number"
            value={seatGroup.rotation}
            disabled={disabled}
            onChange={(event) => onRotateSeatGroup(seatGroup.id, toNumber(event.target.value, 0), seatGroup.rotation ?? 0)}
            className={MAP_PANEL_FIELD_CLASS}
          />
        </PanelField>
      </PanelSection>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={disabled}
        className="w-full border border-red-600 bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500"
        onClick={() => onDeleteSection(section.id)}
      >
        Excluir setor
      </Button>
    </>
  );
}
