'use client';
import {
  isItemSelected,
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
import { MAP_FLOATING_SHADOW_CLASS } from './map-toolbar-styles';
import { CreatorIcon } from '@/components/icons/hugeicons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

function getLayerItemSortId(item: LevelPanelChildItem) {
  return `${item.kind}-${item.id}`;
}

type LayerInsertionIndicator = {
  targetId: string;
  edge: 'before' | 'after';
};

function getLayerDropIndex(
  items: LevelPanelChildItem[],
  activeId: string,
  indicator: LayerInsertionIndicator | null,
) {
  if (!indicator) return null;
  const fromIndex = items.findIndex((item) => getLayerItemSortId(item) === activeId);
  const targetIndex = items.findIndex((item) => getLayerItemSortId(item) === indicator.targetId);
  if (fromIndex < 0 || targetIndex < 0) return null;

  let toIndex = indicator.edge === 'after' ? targetIndex + 1 : targetIndex;
  if (fromIndex < toIndex) toIndex -= 1;
  return Math.max(0, Math.min(items.length - 1, toIndex));
}

function isSectionHidden(map: EventMapDTO, sectionId: string) {
  const section = map.document?.sections.find((entry) => entry.id === sectionId);
  if (section) return section.hidden ?? false;
  const dtoSection = map.sections.find((entry) => entry.id === sectionId);
  if (dtoSection?.hidden !== undefined) return dtoSection.hidden;
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
  onReorder,
  moveUpDisabled,
  moveDownDisabled,
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
  onReorder?: (action: 'up' | 'down' | 'front' | 'back') => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
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
          'border-dashed border-slate-300/80 bg-slate-50/50 shadow-none',
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
            'inline-flex h-7 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-40',
            isDragOverlay && 'cursor-grabbing text-slate-400',
          )}
        >
          <CreatorIcon name="dragHandle" size={14} />
        </button>
      ) : null}

      {expandable ? (
        <LayerActionButton
          label={expandable.expanded ? 'Recolher grupo' : 'Expandir grupo'}
          disabled={disabled}
          onClick={expandable.onToggle}
        >
          <CreatorIcon
            name="back"
            size={14}
            className={cn('rotate-180 transition-transform duration-200', expandable.expanded && 'rotate-90')}
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
        {onReorder ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Ações da camada ${label}`}
                disabled={disabled || isDragOverlay}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40"
              >
                <span aria-hidden>⋯</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem disabled={moveUpDisabled} onSelect={() => onReorder('up')}>
                Mover para cima
              </DropdownMenuItem>
              <DropdownMenuItem disabled={moveDownDisabled} onSelect={() => onReorder('down')}>
                Mover para baixo
              </DropdownMenuItem>
              <DropdownMenuItem disabled={moveUpDisabled} onSelect={() => onReorder('front')}>
                Trazer para frente
              </DropdownMenuItem>
              <DropdownMenuItem disabled={moveDownDisabled} onSelect={() => onReorder('back')}>
                Enviar para trás
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {showVisibility && onToggleVisibility ? (
          <LayerActionButton
            label={hidden ? 'Mostrar camada' : 'Ocultar camada'}
            disabled={disabled || isDragOverlay}
            onClick={onToggleVisibility}
          >
            <CreatorIcon name={hidden ? 'hidden' : 'visible'} size={14} />
          </LayerActionButton>
        ) : null}
        {showDelete && onDelete ? (
          <LayerActionButton label="Excluir camada" disabled={disabled || isDragOverlay} onClick={onDelete}>
            <CreatorIcon name="delete" size={14} />
          </LayerActionButton>
        ) : null}
      </div>
    </div>
  );
}

function LayerInsertionLine({ edge }: { edge: 'before' | 'after' }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-0 right-0 z-10 h-0 transition-transform duration-200 ease-out',
        edge === 'before' ? 'top-0' : 'bottom-0',
      )}
      aria-hidden
    >
      <span className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-brand-accent shadow-[0_0_0_2px_rgba(124,58,237,0.12)]" />
      <span className="absolute left-2 top-0 h-1.5 w-1.5 -translate-y-[3px] rounded-full bg-brand-accent" />
    </div>
  );
}

function DraggableLayerBlock({
  id,
  disabled,
  onNodeChange,
  previewOffsetY = 0,
  children,
}: {
  id: string;
  disabled?: boolean;
  onNodeChange?: (id: string, node: HTMLDivElement | null) => void;
  previewOffsetY?: number;
  children: (props: {
    dragHandleProps: HTMLAttributes<HTMLButtonElement>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id,
    disabled,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({ id, disabled });

  const style = {
    // Keep the source row as a fixed-size placeholder; DragOverlay is the only
    // element that follows the pointer, so the measured drop targets stay still.
    transform: previewOffsetY ? `translate3d(0, ${previewOffsetY}px, 0)` : undefined,
    transition: 'transform 180ms ease-out, opacity 180ms ease-out, border-color 160ms ease, background-color 160ms ease',
  };

  return (
    <div
      ref={(node) => {
        setDroppableRef(node);
        onNodeChange?.(id, node);
      }}
    >
      <div ref={setDraggableRef} style={style} className={cn(isDragging && 'opacity-0')}>
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
  onReorder?: (action: 'up' | 'down' | 'front' | 'back') => void;
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
    onReorder?: (action: 'up' | 'down' | 'front' | 'back') => void;
  },
): LayerRowContent | null {
  if (item.kind === 'section') {
    const section = map.sections.find((entry) => entry.id === item.id);
    if (!section) return null;
    const hidden = isSectionHidden(map, section.id);

    return {
      label: section.name,
      preview: <MapSectionPreview color={section.color} size={22} />,
      selected: isItemSelected(options.selection, { type: 'section', id: section.id }),
      hidden,
      showVisibility: true,
      showDelete: true,
      onSelect: () => options.setSelection(replaceSelection({ type: 'section', id: section.id })),
      onToggleVisibility: () => options.toggleSectionVisibility(section.id),
      onDelete: () => options.deleteSection(section.id),
      onReorder: options.onReorder,
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
          <CreatorIcon name="block" size={14} />
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
      onReorder: options.onReorder,
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
    onReorder: options.onReorder,
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
    onReorder?: (action: 'up' | 'down' | 'front' | 'back') => void;
    moveUpDisabled?: boolean;
    moveDownDisabled?: boolean;
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
          moveUpDisabled={options.moveUpDisabled}
          moveDownDisabled={options.moveDownDisabled}
        />

        {expanded
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
      moveUpDisabled={options.moveUpDisabled}
      moveDownDisabled={options.moveDownDisabled}
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
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const layerRowRefs = useRef(new Map<string, HTMLDivElement>());
  const activeDragIdRef = useRef<string | null>(null);
  const grabOffsetRef = useRef<number | null>(null);
  const latestPointerYRef = useRef<number | null>(null);

  useEffect(() => {
    setOverlayContainer(document.body);
  }, []);

  const childItems = useMemo(() => {
    if (!map || !activeLevel) return [];
    return sortLevelPanelChildren(map.sections, map.objects, activeLevel.id);
  }, [activeLevel, map]);

  const activeDragItem = useMemo(
    () => childItems.find((item) => getLayerItemSortId(item) === activeDragId) ?? null,
    [activeDragId, childItems],
  );
  const activeDragIndex = activeDragId
    ? childItems.findIndex((item) => getLayerItemSortId(item) === activeDragId)
    : -1;
  const previewDestinationIndex = activeDragId
    ? getLayerDropIndex(childItems, activeDragId, insertionIndicator)
    : null;

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

  function getLayerPreviewOffset(index: number) {
    if (
      activeDragIndex < 0 ||
      previewDestinationIndex === null ||
      activeDragIndex === previewDestinationIndex
    ) {
      return 0;
    }

    const activeId = activeDragId;
    if (!activeId) return 0;
    const activeHeight = layerRowRefs.current.get(activeId)?.getBoundingClientRect().height ?? 0;
    const offset = activeHeight + 4;
    if (activeDragIndex < previewDestinationIndex) {
      return index > activeDragIndex && index <= previewDestinationIndex ? -offset : 0;
    }
    return index >= previewDestinationIndex && index < activeDragIndex ? offset : 0;
  }

  const resolveInsertionFromPointer = useCallback((
    pointerY: number,
    activeId: string,
  ): LayerInsertionIndicator | null => {
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
  }, [childItems]);

  useEffect(() => {
    function updatePointerPosition(event: PointerEvent) {
      latestPointerYRef.current = event.clientY;
      const activeId = activeDragIdRef.current;
      if (activeId) {
        setInsertionIndicator(resolveInsertionFromPointer(event.clientY, activeId));
      }
    }

    // Capture phase runs before dnd-kit's PointerSensor end handler, so the
    // release coordinate is available synchronously to handleDragEnd.
    document.addEventListener('pointermove', updatePointerPosition, true);
    document.addEventListener('pointerup', updatePointerPosition, true);
    return () => {
      document.removeEventListener('pointermove', updatePointerPosition, true);
      document.removeEventListener('pointerup', updatePointerPosition, true);
    };
  }, [resolveInsertionFromPointer]);

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    activeDragIdRef.current = activeId;
    setActiveDragId(activeId);
    setInsertionIndicator(null);
    const activatorY =
      'clientY' in event.activatorEvent && typeof event.activatorEvent.clientY === 'number'
        ? event.activatorEvent.clientY
        : null;
    const initialRect = event.active.rect.current.initial ?? layerRowRefs.current.get(activeId)?.getBoundingClientRect();
    grabOffsetRef.current = activatorY !== null && initialRect ? activatorY - initialRect.top : null;
    latestPointerYRef.current = activatorY === null
      ? null
      : latestPointerYRef.current ?? activatorY;
  }

  function handleDragMove(event: DragMoveEvent) {
    const activeId = String(event.active.id);
    const translatedRect = event.active.rect.current.translated;
    if (!translatedRect) return;
    const pointerY = latestPointerYRef.current ??
      translatedRect.top + (grabOffsetRef.current ?? translatedRect.height / 2);
    latestPointerYRef.current = pointerY;
    setInsertionIndicator(resolveInsertionFromPointer(pointerY, activeId));
  }

  function handleDragCancel() {
    setActiveDragId(null);
    activeDragIdRef.current = null;
    setInsertionIndicator(null);
    grabOffsetRef.current = null;
    latestPointerYRef.current = null;
  }

  function reorderItemAt(index: number, action: 'up' | 'down' | 'front' | 'back') {
    if (!activeLevel || childItems.length < 2) return;
    const toIndex = action === 'up'
      ? Math.max(0, index - 1)
      : action === 'down'
        ? Math.min(childItems.length - 1, index + 1)
        : action === 'front' ? 0 : childItems.length - 1;
    reorderLevelLayers(activeLevel.id, index, toIndex);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const translatedRect = event.active.rect.current.translated;
    // Resolve again at release using dnd-kit's translated rectangle. This stays
    // correct when the scroll container moved during the drag and avoids a stale
    // React state value winning a fast release.
    const pointerY = latestPointerYRef.current ?? (translatedRect
      ? translatedRect.top + (grabOffsetRef.current ?? translatedRect.height / 2)
      : null);
    const indicator = pointerY !== null
      ? resolveInsertionFromPointer(pointerY, activeId)
      : insertionIndicator;
    setActiveDragId(null);
    activeDragIdRef.current = null;
    setInsertionIndicator(null);
    grabOffsetRef.current = null;
    latestPointerYRef.current = null;
    if (!activeLevel || !map) return;

    const { active } = event;
    const targetId = indicator?.targetId;
    if (!targetId) return;

    const fromIndex = childItems.findIndex((item) => getLayerItemSortId(item) === active.id);
    const toIndex = getLayerDropIndex(childItems, String(active.id), indicator);
    if (toIndex === null) return;
    if (fromIndex === -1 || fromIndex === toIndex) return;

    reorderLevelLayers(activeLevel.id, fromIndex, toIndex);
  }

  if (!map) return null;

  return (
    <aside className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 ${MAP_FLOATING_SHADOW_CLASS} backdrop-blur`}>
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <CreatorIcon name="layers" size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-950">Camadas</h2>
        </div>
        <p className="text-xs text-slate-500">Arraste para definir o que fica na frente no mapa.</p>
      </div>

      <div
        className={cn(
          'min-h-0 overflow-y-auto p-2',
          visibleLayerRows > 5 && 'max-h-[15.25rem] overscroll-contain pr-1',
        )}
        onScroll={() => {
          if (activeDragIdRef.current && latestPointerYRef.current !== null) {
            setInsertionIndicator(
              resolveInsertionFromPointer(latestPointerYRef.current, activeDragIdRef.current),
            );
          }
        }}
      >
        {activeLevel ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div key={activeLevel.id} className="flex flex-col gap-1">
              {childItems.map((item, index) => {
                const itemId = getLayerItemSortId(item);
                return (
                  <div key={itemId} className="relative flex flex-col gap-1">
                    <DraggableLayerBlock
                      id={itemId}
                      disabled={disabled}
                      onNodeChange={setLayerRowRef}
                      previewOffsetY={getLayerPreviewOffset(index)}
                    >
                      {({ dragHandleProps, isDragging }) =>
                        renderLayerItem(item, map, {
                          ...layerItemOptions,
                          onReorder: (action) => reorderItemAt(index, action),
                          moveUpDisabled: index === 0,
                          moveDownDisabled: index === childItems.length - 1,
                          dragHandleProps,
                          isDragging,
                        })
                      }
                    </DraggableLayerBlock>
                    {insertionIndicator?.targetId === itemId ? (
                      <LayerInsertionLine
                        edge={insertionIndicator.edge}
                      />
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

            {overlayContainer
              ? createPortal(
                  <DragOverlay dropAnimation={null}>
                    {activeDragItem ? (
                      <div className="pointer-events-none w-[calc(100%-0px)] min-w-[14rem] cursor-grabbing">
                        {renderLayerItem(activeDragItem, map, {
                          ...layerItemOptions,
                          onReorder: undefined,
                          isDragOverlay: true,
                        })}
                      </div>
                    ) : null}
                  </DragOverlay>,
                  overlayContainer,
                )
              : null}
          </DndContext>
        ) : null}
      </div>
    </aside>
  );
}
