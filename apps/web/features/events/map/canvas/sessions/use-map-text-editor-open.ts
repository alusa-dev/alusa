'use client';

import { getSelectableItems, getTextMode, replaceSelection, resolveGroupSelectionItem, type MapSelection, type MapSelectionItem, type TextMode } from '@alusa/domain';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect } from 'react';
import Konva from 'konva';
import type { EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import type { MapTool } from '../../store/event-map-editor-store';
import { buildTextEditorState, buildTextEditorStateForObject, type TextEditorState } from '../render/text-editor-layout';

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function useMapTextEditorOpen({
  readOnly,
  textEditSnapshotRef,
  stageRef,
  containerRef,
  zoom,
  pan,
  levelObjects,
  tool,
  textEditor,
  setSelection,
  setInlineTextEditorActive,
  setTextEditor,
}: {
  readOnly: boolean;
  textEditSnapshotRef: MutableRefObject<string | null>;
  stageRef: RefObject<Konva.Stage | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: { x: number; y: number };
  levelObjects: EventMapObjectDTO[];
  tool: MapTool;
  textEditor: TextEditorState | null;
  setSelection: (selection: MapSelectionItem | MapSelection | null) => void;
  setInlineTextEditorActive: (active: boolean) => void;
  setTextEditor: Dispatch<SetStateAction<TextEditorState | null>>;
}) {
  const openTextEditor = useCallback(
    (object: EventMapObjectDTO, node: Konva.Text) => {
      if (readOnly) return;
      const stage = stageRef.current;
      const container = containerRef.current;
      if (!stage || !container) return;

      textEditSnapshotRef.current = String(object.data.text ?? '');

      const groupItems = resolveGroupSelectionItem({ type: 'object', id: object.id }, levelObjects);
      setSelection(groupItems.length > 1 ? groupItems : replaceSelection({ type: 'object', id: object.id }));
      setInlineTextEditorActive(true);
      setTextEditor(buildTextEditorStateForObject({ object, stage, container, zoom, pan, node }));
    },
    [
      containerRef,
      levelObjects,
      pan,
      readOnly,
      setInlineTextEditorActive,
      setSelection,
      setTextEditor,
      stageRef,
      textEditSnapshotRef,
      zoom,
    ],
  );

  const openNewTextEditor = useCallback(
    (box: { x: number; y: number; width: number | null; height: number | null; textMode: TextMode }) => {
      const stage = stageRef.current;
      const container = containerRef.current;
      if (!stage || !container) return;

      textEditSnapshotRef.current = null;
      setSelection([]);
      setInlineTextEditorActive(true);
      setTextEditor(
        buildTextEditorState({
          objectId: null,
          value: '',
          mapX: box.x,
          mapY: box.y,
          mapWidth: box.width,
          mapHeight: box.height,
          textMode: box.textMode,
          rotation: 0,
          baseFontSize: 22,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 'normal',
          letterSpacing: 0,
          color: '#0f172a',
          lineHeight: 1.2,
          textAlign: 'left',
          stage,
          container,
          zoom,
          pan,
        }),
      );
    },
    [
      containerRef,
      pan,
      setInlineTextEditorActive,
      setSelection,
      setTextEditor,
      stageRef,
      textEditSnapshotRef,
      zoom,
    ],
  );

  useEffect(() => {
    if (readOnly || textEditor) return;

    function onEnterEdit(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;

      const store = useEventMapEditorStore.getState();
      if (store.tool !== 'select') return;
      const selectable = getSelectableItems(store.selection);
      if (selectable.length !== 1 || selectable[0]?.type !== 'object') return;
      const object = store.map?.objects.find((entry) => entry.id === selectable[0]?.id);
      if (!object || object.type !== 'TEXT' || object.locked) return;

      event.preventDefault();
      const stage = stageRef.current;
      const container = containerRef.current;
      const node = stage?.findOne(`#node-${object.id}`);
      if (!stage || !container || !(node instanceof Konva.Text)) return;

      openTextEditor(object, node);
    }

    window.addEventListener('keydown', onEnterEdit);
    return () => window.removeEventListener('keydown', onEnterEdit);
  }, [containerRef, openTextEditor, readOnly, stageRef, textEditor, tool]);

  return { openTextEditor, openNewTextEditor };
}
