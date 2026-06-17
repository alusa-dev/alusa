'use client';
import {
  isItemSelected,
  isSeatedSectorLayerSelected,
  replaceSelection,
  resolveGroupSelectionItem,
  sortLevelPanelChildren,
  type LevelPanelChildItem,
  type MapSelection,
  type MapSelectionItem,
} from '@alusa/domain';
import type { EventMapDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import { MapObjectPreview, MapSectionPreview } from './MapObjectPreview';

import { cn } from '@/lib/utils';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronRight, Eye, EyeOff, GripVertical, Group, Layers3, Trash2 } from 'lucide-react';

function getLayerItemSortId(item: LevelPanelChildItem) {
  return `${item.kind}-${item.id}`;
}

type LayerInsertionIndicator = {
  targetId: string;
  edge: 'before' | 'after';
};

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
  sortable,
  isDragging,
  isDragOverlay,
  dragHandleProps,
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
  sortable?: boolean;
  isDragging?: boolean;
  isDragOverlay?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  showVisibility?: boolean;
  showDelete?: boolean;
  onSelect: () => void;
  onToggleVisibility?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-1 rounded-lg border transition-[border-color,background-color,box-shadow,opacity,transform] duration-200',
        expandable ? 'pl-1 pr-2' : 'px-2',
        indented ? 'ml-7' : '',
        isDragOverlay &&
          'border-brand-accent/35 bg-white text-slate-950 shadow-lg shadow-slate-300/35 ring-1 ring-brand-accent/15',
        !isDragOverlay &&
          isDragging &&
          'border-dashed border-slate-300/80 bg-slate-50/50 opacity-35 shadow-none',
        !isDragOverlay &&
          !isDragging &&
          (selected
            ? 'border-slate-300 bg-slate-100 text-slate-950 shadow-sm'
            : 'border-slate-200/90 bg-slate-50/90 text-slate-600 hover:border-slate-300 hover:bg-slate-100/80'),
        hidden && !isDragOverlay && 'opacity-60',
      )}
    >
      {sortable ? (
        <button
          type="button"
          aria-label={`Reordenar camada ${label}`}
          disabled={disabled}
          {...dragHandleProps}
          className={cn(
            'inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-40',
            isDragOverlay && 'cursor-grabbing text-slate-400',
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : null}

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
        disabled={disabled || isDragOverlay}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors',
          selected ? 'font-medium' : 'font-normal',
          (disabled || isDragOverlay) && 'cursor-default',
        )}
      >
        {preview}
        <span className={cn('truncate', hidden && 'text-slate-400')}>{label}</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {showVisibility && onToggleVisibility ? (
          <LayerActionButton
            label={hidden ? 'Mostrar camada' : 'Ocultar camada'}
            disabled={disabled || isDragOverlay}
            onClick={onToggleVisibility}
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </LayerActionButton>
        ) : null}
        {showDelete && onDelete ? (
          <LayerActionButton label="Excluir camada" disabled={disabled || isDragOverlay} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </LayerActionButton>
        ) : null}
      </div>
    </div>
  );
}

function LayerInsertionLine() {
  return (
    <div className="relative -my-0.5 h-2 px-1" aria-hidden>
      <span className="absolute left-3 right-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-brand-accent shadow-[0_0_0_2px_rgba(124,58,237,0.12)]" />
      <span className="absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-accent" />
    </div>
  );
}

function DraggableLayerBlock({
  id,
  disabled,
  onNodeChange,
  children,
}: {
  id: string;
  disabled?: boolean;
  onNodeChange?: (id: string, node: HTMLDivElement | null) => void;
  children: (props: {
    dragHandleProps: HTMLAttributes<HTMLButtonElement>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({ id, disabled });

  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition: isDragging ? undefined : 'opacity 160ms ease, border-color 160ms ease, background-color 160ms ease',
  };

  return (
    <div
      ref={(node) => {
        setDroppableRef(node);
        onNodeChange?.(id, node);
      }}
    >
      <div ref={setDraggableRef} style={style} className="touch-none">
        {children({
          dragHandleProps: {
            ...attributes,
            ...listeners,
          },
          isDragging,
        })}
      </div>
    </div>
  );
}

type LayerRowContent = {
  label: string;
  preview: ReactNode;
  selected?: boolean;
  hidden?: boolean;
  expandable?: { expanded: boolean; onToggle: () => void };
  showVisibility?: boolean;
  showDelete?: boolean;
  onSelect: () => void;
  onToggleVisibility?: () => void;
  onDelete?: () => void;
};

function buildLayerRowContent(
  item: LevelPanelChildItem,
  map: EventMapDTO,
  options: {
    disabled: boolean;
    selection: MapSelection;
    expandedGroups: Record<string, boolean>;
    setSelection: (selection: MapSelectionItem | MapSelection | null) => void;
    toggleGroupExpanded: (groupId: string) => void;
    toggleObjectVisibility: (id: string) => void;
    toggleSectionVisibility: (id: string) => void;
    deleteObject: (id: string) => void;
    deleteSection: (id: string) => void;
  },
): LayerRowContent | null {
  if (item.kind === 'section') {
    const section = map.sections.find((entry) => entry.id === item.id);
    if (!section) return null;
    const hidden = isSectionHidden(map, section.id);

    return {
      label: section.name,
      preview: <MapSectionPreview color={section.color} size={22} />,
      selected: isSeatedSectorLayerSelected(map, options.selection, section.id),
      hidden,
      showVisibility: true,
      showDelete: true,
      onSelect: () => options.setSelection(replaceSelection({ type: 'section', id: section.id })),
      onToggleVisibility: () => options.toggleSectionVisibility(section.id),
      onDelete: () => options.deleteSection(section.id),
    };
  }

  if (item.kind === 'group') {
    const groupObjects = item.objectIds
      .map((objectId) => map.objects.find((entry) => entry.id === objectId))
      .filter((object): object is NonNullable<typeof object> => Boolean(object));
    const hidden = groupObjects.length > 0 && groupObjects.every((object) => object.hidden);
    const selected = item.objectIds.every((objectId) =>
      isItemSelected(options.selection, { type: 'object', id: objectId }),
    );
    const expanded = options.expandedGroups[item.id] ?? false;

    return {
      label: item.label,
      preview: (
        <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border border-slate-300 bg-white text-slate-500">
          <Group className="h-3.5 w-3.5" />
        </span>
      ),
      selected,
      hidden,
      expandable: { expanded, onToggle: () => options.toggleGroupExpanded(item.id) },
      showDelete: true,
      onSelect: () =>
        options.setSelection(item.objectIds.map((objectId) => ({ type: 'object' as const, id: objectId }))),
      onDelete: () => {
        for (const objectId of item.objectIds) options.deleteObject(objectId);
      },
    };
  }

  const object = map.objects.find((entry) => entry.id === item.id);
  if (!object) return null;

  return {
    label: String(object.data.label ?? object.data.text ?? object.type),
    preview: (
      <span className="relative shrink-0">
        <MapObjectPreview object={object} size={22} />
      </span>
    ),
    selected: isItemSelected(options.selection, { type: 'object', id: object.id }),
    hidden: object.hidden,
    showVisibility: true,
    showDelete: true,
    onSelect: () => options.setSelection(replaceSelection({ type: 'object', id: object.id })),
    onToggleVisibility: () => options.toggleObjectVisibility(object.id),
    onDelete: () => options.deleteObject(object.id),
  };
}

function renderLayerItem(
  item: LevelPanelChildItem,
  map: EventMapDTO,
  options: {
    disabled: boolean;
    selection: MapSelection;
    expandedGroups: Record<string, boolean>;
    setSelection: (selection: MapSelectionItem | MapSelection | null) => void;
    toggleGroupExpanded: (groupId: string) => void;
    toggleObjectVisibility: (id: string) => void;
    toggleSectionVisibility: (id: string) => void;
    deleteObject: (id: string) => void;
    deleteSection: (id: string) => void;
    isDragOverlay?: boolean;
    dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
    isDragging?: boolean;
  },
) {
  const rowContent = buildLayerRowContent(item, map, options);
  if (!rowContent) return null;

  if (item.kind === 'group') {
    const groupObjects = item.objectIds
      .map((objectId) => map.objects.find((entry) => entry.id === objectId))
      .filter((object): object is NonNullable<typeof object> => Boolean(object));
    const expanded = options.expandedGroups[item.id] ?? false;

    return (
      <div className="flex flex-col gap-1">
        <LayerRow
          disabled={options.disabled}
          sortable={!options.isDragOverlay}
          isDragging={options.isDragging}
          isDragOverlay={options.isDragOverlay}
          dragHandleProps={options.dragHandleProps}
          {...rowContent}
        />

        {expanded && !options.isDragOverlay
          ? groupObjects.map((object) => (
              <LayerRow
                key={object.id}
                indented
                disabled={options.disabled}
                selected={isItemSelected(options.selection, { type: 'object', id: object.id })}
                hidden={object.hidden}
                label={String(object.data.label ?? object.data.text ?? object.type)}
                preview={
                  <span className="relative shrink-0">
                    <MapObjectPreview object={object} size={22} />
                  </span>
                }
                showVisibility
                showDelete
                onSelect={() =>
                  options.setSelection(resolveGroupSelectionItem({ type: 'object', id: object.id }, map.objects))
                }
                onToggleVisibility={() => options.toggleObjectVisibility(object.id)}
                onDelete={() => options.deleteObject(object.id)}
              />
            ))
          : null}
      </div>
    );
  }

  return (
    <LayerRow
      disabled={options.disabled}
      sortable={!options.isDragOverlay}
      isDragging={options.isDragging}
      isDragOverlay={options.isDragOverlay}
      dragHandleProps={options.dragHandleProps}
      {...rowContent}
    />
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
  const reorderLevelLayers = useEventMapEditorStore((state) => state.reorderLevelLayers);

  const activeLevel = useMemo(
    () => map?.levels.find((level) => level.id === activeLevelId) ?? map?.levels[0] ?? null,
    [activeLevelId, map?.levels],
  );
  const disabled = map?.status === 'ARCHIVED';
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [insertionIndicator, setInsertionIndicator] = useState<LayerInsertionIndicator | null>(null);
  const layerRowRefs = useRef(new Map<string, HTMLDivElement>());
  const dragStartPointerYRef = useRef<number | null>(null);

  const childItems = useMemo(() => {
    if (!map || !activeLevel) return [];
    return sortLevelPanelChildren(map.sections, map.objects, activeLevel.id);
  }, [activeLevel, map]);

  const activeDragItem = useMemo(
    () => childItems.find((item) => getLayerItemSortId(item) === activeDragId) ?? null,
    [activeDragId, childItems],
  );

  const visibleLayerRows = useMemo(() => {
    return childItems.reduce((count, item) => {
      if (item.kind === 'group' && (expandedGroups[item.id] ?? false)) {
        return count + 1 + item.objectIds.length;
      }
      return count + 1;
    }, 0);
  }, [childItems, expandedGroups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const layerItemOptions = {
    disabled,
    selection,
    expandedGroups,
    setSelection,
    toggleGroupExpanded: (groupId: string) => {
      setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
    },
    toggleObjectVisibility,
    toggleSectionVisibility,
    deleteObject,
    deleteSection,
  };

  function setLayerRowRef(id: string, node: HTMLDivElement | null) {
    if (node) {
      layerRowRefs.current.set(id, node);
      return;
    }
    layerRowRefs.current.delete(id);
  }

  function resolveInsertionFromPointer(pointerY: number, activeId: string): LayerInsertionIndicator | null {
    const itemIds = childItems.map(getLayerItemSortId).filter((id) => id !== activeId);
    if (itemIds.length === 0) return null;

    const rowRects = itemIds
      .map((id) => {
        const node = layerRowRefs.current.get(id);
        return node ? { id, rect: node.getBoundingClientRect() } : null;
      })
      .filter((entry): entry is { id: string; rect: DOMRect } => Boolean(entry));
    if (rowRects.length === 0) return null;

    const first = rowRects[0];
    const last = rowRects[rowRects.length - 1];
    if (!first || !last) return null;

    if (pointerY <= first.rect.top) {
      return { targetId: first.id, edge: 'before' };
    }
    if (pointerY >= last.rect.bottom) {
      return { targetId: last.id, edge: 'after' };
    }

    const containing = rowRects.find(({ rect }) => pointerY >= rect.top && pointerY <= rect.bottom);
    if (containing) {
      const midpoint = containing.rect.top + containing.rect.height / 2;
      return { targetId: containing.id, edge: pointerY < midpoint ? 'before' : 'after' };
    }

    const nextRow = rowRects.find(({ rect }) => pointerY < rect.top);
    if (nextRow) return { targetId: nextRow.id, edge: 'before' };

    return { targetId: last.id, edge: 'after' };
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
    setInsertionIndicator(null);
    dragStartPointerYRef.current =
      'clientY' in event.activatorEvent ? Number(event.activatorEvent.clientY) : null;
  }

  function handleDragMove(event: DragMoveEvent) {
    const activeId = String(event.active.id);
    const startPointerY = dragStartPointerYRef.current;
    if (startPointerY === null) return;
    setInsertionIndicator(resolveInsertionFromPointer(startPointerY + event.delta.y, activeId));
  }

  function handleDragOver(event: DragOverEvent) {
    if (dragStartPointerYRef.current !== null) return;
    const overId = event.over?.id ? String(event.over.id) : null;
    const activeId = String(event.active.id);
    const overRect = event.over?.rect;
    const activeRect = event.active.rect.current.translated;

    if (!overId || overId === activeId || !overRect || !activeRect) {
      setInsertionIndicator(null);
      return;
    }

    const activeCenterY = activeRect.top + activeRect.height / 2;
    const overCenterY = overRect.top + overRect.height / 2;
    setInsertionIndicator({
      targetId: overId,
      edge: activeCenterY < overCenterY ? 'before' : 'after',
    });
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setInsertionIndicator(null);
    dragStartPointerYRef.current = null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const indicator = insertionIndicator;
    setActiveDragId(null);
    setInsertionIndicator(null);
    dragStartPointerYRef.current = null;
    if (!activeLevel || !map) return;

    const { active, over } = event;
    const targetId = indicator?.targetId ?? (over?.id ? String(over.id) : null);
    if (!targetId || active.id === targetId) return;

    const fromIndex = childItems.findIndex((item) => getLayerItemSortId(item) === active.id);
    const targetIndex = childItems.findIndex((item) => getLayerItemSortId(item) === targetId);
    let toIndex = indicator?.edge === 'after' ? targetIndex + 1 : targetIndex;
    if (fromIndex < toIndex) toIndex -= 1;
    toIndex = Math.max(0, Math.min(childItems.length - 1, toIndex));
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    reorderLevelLayers(activeLevel.id, fromIndex, toIndex);
  }

  if (!map) return null;

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-brand-accent" />
          <h2 className="text-sm font-semibold text-slate-950">Camadas</h2>
        </div>
        <p className="text-xs text-slate-500">Arraste para definir o que fica na frente no mapa.</p>
      </div>

      <div
        className={cn(
          'min-h-0 overflow-y-auto p-2',
          visibleLayerRows > 5 && 'max-h-[15.25rem] overscroll-contain pr-1',
        )}
      >
        {activeLevel ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div key={activeLevel.id} className="flex flex-col gap-1">
              {childItems.map((item) => {
                const itemId = getLayerItemSortId(item);
                return (
                  <div key={itemId} className="flex flex-col gap-1">
                    {insertionIndicator?.targetId === itemId && insertionIndicator.edge === 'before' ? (
                      <LayerInsertionLine />
                    ) : null}
                    <DraggableLayerBlock id={itemId} disabled={disabled} onNodeChange={setLayerRowRef}>
                      {({ dragHandleProps, isDragging }) =>
                        renderLayerItem(item, map, {
                          ...layerItemOptions,
                          dragHandleProps,
                          isDragging,
                        })
                      }
                    </DraggableLayerBlock>
                    {insertionIndicator?.targetId === itemId && insertionIndicator.edge === 'after' ? (
                      <LayerInsertionLine />
                    ) : null}
                  </div>
                );
              })}

              {childItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-xs text-slate-500">
                  Nenhum item nesta área.
                </div>
              ) : null}
            </div>

            <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1)' }}>
              {activeDragItem ? (
                <div className="w-[calc(100%-0px)] min-w-[14rem] cursor-grabbing">
                  {renderLayerItem(activeDragItem, map, {
                    ...layerItemOptions,
                    isDragOverlay: true,
                  })}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </div>
    </aside>
  );
}
