'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Eye, EyeOff, Group, Layers3, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { EventMapDTO } from '../api/event-map-service';
import { sortLevelPanelChildren } from '../lib/level-utils';
import { resolveGroupSelectionItem } from '../lib/object-groups';
import { isItemSelected, replaceSelection } from '../lib/selection-utils';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import { MapObjectPreview, MapSectionPreview } from './MapObjectPreview';

function isSectionHidden(map: EventMapDTO, sectionId: string) {
  const linked = map.objects.find((object) => object.sectionId === sectionId);
  return linked?.hidden ?? false;
}

function LayerActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LayerRow({
  selected,
  hidden,
  label,
  preview,
  disabled,
  indented,
  expandable,
  showVisibility,
  showDelete,
  onSelect,
  onToggleVisibility,
  onDelete,
}: {
  selected?: boolean;
  hidden?: boolean;
  label: string;
  preview: ReactNode;
  disabled?: boolean;
  indented?: boolean;
  expandable?: { expanded: boolean; onToggle: () => void };
  showVisibility?: boolean;
  showDelete?: boolean;
  onSelect: () => void;
  onToggleVisibility?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 rounded-lg border transition-colors',
        expandable ? 'px-2' : 'px-3',
        indented ? 'ml-7' : '',
        selected
          ? 'border-slate-300 bg-slate-100 text-slate-950 shadow-sm'
          : 'border-slate-200/90 bg-slate-50/90 text-slate-600 hover:border-slate-300 hover:bg-slate-100/80',
        hidden && 'opacity-60',
      )}
    >
      {expandable ? (
        <LayerActionButton
          label={expandable.expanded ? 'Recolher grupo' : 'Expandir grupo'}
          disabled={disabled}
          onClick={expandable.onToggle}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform duration-200', expandable.expanded && 'rotate-90')}
          />
        </LayerActionButton>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors',
          selected ? 'font-medium' : 'font-normal',
          disabled && 'cursor-default',
        )}
      >
        {preview}
        <span className={cn('truncate', hidden && 'text-slate-400')}>{label}</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {showVisibility && onToggleVisibility ? (
          <LayerActionButton
            label={hidden ? 'Mostrar camada' : 'Ocultar camada'}
            disabled={disabled}
            onClick={onToggleVisibility}
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </LayerActionButton>
        ) : null}
        {showDelete && onDelete ? (
          <LayerActionButton label="Excluir camada" disabled={disabled} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </LayerActionButton>
        ) : null}
      </div>
    </div>
  );
}

export function MapLayersPanel() {
  const map = useEventMapEditorStore((state) => state.map);
  const activeLevelId = useEventMapEditorStore((state) => state.activeLevelId);
  const selection = useEventMapEditorStore((state) => state.selection);
  const setSelection = useEventMapEditorStore((state) => state.setSelection);
  const toggleObjectVisibility = useEventMapEditorStore((state) => state.toggleObjectVisibility);
  const toggleSectionVisibility = useEventMapEditorStore((state) => state.toggleSectionVisibility);
  const deleteObject = useEventMapEditorStore((state) => state.deleteObject);
  const deleteSection = useEventMapEditorStore((state) => state.deleteSection);

  const activeLevel = useMemo(
    () => map?.levels.find((level) => level.id === activeLevelId) ?? map?.levels[0] ?? null,
    [activeLevelId, map?.levels],
  );
  const disabled = map?.status !== 'DRAFT';
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const visibleLayerRows = useMemo(() => {
    if (!map || !activeLevel) return 0;

    const childItems = sortLevelPanelChildren(map.sections, map.objects, activeLevel.id);
    return childItems.reduce((count, item) => {
      if (item.kind === 'group' && (expandedGroups[item.id] ?? false)) {
        return count + 1 + item.objectIds.length;
      }
      return count + 1;
    }, 0);
  }, [activeLevel, expandedGroups, map]);

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  if (!map) return null;

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-brand-accent" />
          <h2 className="text-sm font-semibold text-slate-950">Camadas</h2>
        </div>
        <p className="text-xs text-slate-500">Estrutura do mapa</p>
      </div>

      <div
        className={cn(
          'min-h-0 overflow-y-auto p-2',
          visibleLayerRows > 5 && 'max-h-[15.25rem] overscroll-contain pr-1',
        )}
      >
        {activeLevel ? (
          (() => {
            const childItems = sortLevelPanelChildren(map.sections, map.objects, activeLevel.id);

            return (
            <div key={activeLevel.id} className="flex flex-col gap-1">
              {childItems.map((item) => {
                if (item.kind === 'section') {
                  const section = map.sections.find((entry) => entry.id === item.id);
                  if (!section) return null;
                  const hidden = isSectionHidden(map, section.id);

                  return (
                    <LayerRow
                      key={section.id}
                      selected={isItemSelected(selection, { type: 'section', id: section.id })}
                      hidden={hidden}
                      disabled={disabled}
                      label={section.name}
                      preview={<MapSectionPreview color={section.color} size={22} />}
                      showVisibility
                      showDelete
                      onSelect={() => setSelection(replaceSelection({ type: 'section', id: section.id }))}
                      onToggleVisibility={() => toggleSectionVisibility(section.id)}
                      onDelete={() => deleteSection(section.id)}
                    />
                  );
                }

                if (item.kind === 'group') {
                  const groupObjects = item.objectIds
                    .map((objectId) => map.objects.find((entry) => entry.id === objectId))
                    .filter((object): object is NonNullable<typeof object> => Boolean(object));
                  const hidden = groupObjects.length > 0 && groupObjects.every((object) => object.hidden);
                  const selected = item.objectIds.every((objectId) =>
                    isItemSelected(selection, { type: 'object', id: objectId }),
                  );
                  const expanded = expandedGroups[item.id] ?? false;

                  return (
                    <div key={item.id} className="flex flex-col gap-1">
                      <LayerRow
                        selected={selected}
                        hidden={hidden}
                        disabled={disabled}
                        label={item.label}
                        expandable={{ expanded, onToggle: () => toggleGroupExpanded(item.id) }}
                        preview={
                          <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border border-slate-300 bg-white text-slate-500">
                            <Group className="h-3.5 w-3.5" />
                          </span>
                        }
                        showDelete
                        onSelect={() =>
                          setSelection(item.objectIds.map((objectId) => ({ type: 'object' as const, id: objectId })))
                        }
                        onDelete={() => {
                          for (const objectId of item.objectIds) deleteObject(objectId);
                        }}
                      />

                      {expanded
                        ? groupObjects.map((object) => (
                            <LayerRow
                              key={object.id}
                              indented
                              selected={isItemSelected(selection, { type: 'object', id: object.id })}
                              hidden={object.hidden}
                              disabled={disabled}
                              label={String(object.data.label ?? object.data.text ?? object.type)}
                              preview={
                                <span className="relative shrink-0">
                                  <MapObjectPreview object={object} size={22} />
                                </span>
                              }
                              showVisibility
                              showDelete
                              onSelect={() =>
                                setSelection(resolveGroupSelectionItem({ type: 'object', id: object.id }, map.objects))
                              }
                              onToggleVisibility={() => toggleObjectVisibility(object.id)}
                              onDelete={() => deleteObject(object.id)}
                            />
                          ))
                        : null}
                    </div>
                  );
                }

                const object = map.objects.find((entry) => entry.id === item.id);
                if (!object) return null;

                return (
                  <LayerRow
                    key={object.id}
                    selected={isItemSelected(selection, { type: 'object', id: object.id })}
                    hidden={object.hidden}
                    disabled={disabled}
                    label={String(object.data.label ?? object.data.text ?? object.type)}
                    preview={
                      <span className="relative shrink-0">
                        <MapObjectPreview object={object} size={22} />
                      </span>
                    }
                    showVisibility
                    showDelete
                    onSelect={() => setSelection(replaceSelection({ type: 'object', id: object.id }))}
                    onToggleVisibility={() => toggleObjectVisibility(object.id)}
                    onDelete={() => deleteObject(object.id)}
                  />
                );
              })}

              {childItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-xs text-slate-500">
                  Nenhum item nesta área.
                </div>
              ) : null}
            </div>
            );
          })()
        ) : null}
      </div>
    </aside>
  );
}
