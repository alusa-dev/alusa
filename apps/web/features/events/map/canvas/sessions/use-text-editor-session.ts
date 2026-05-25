'use client';

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useEffect } from 'react';
import Konva from 'konva';
import {
  getSelectableItems,
  getTextMode,
  replaceSelection,
  resolveGroupSelectionItem,
  type MapSelection,
  type MapSelectionItem,
} from '@alusa/domain';
import type { EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { buildTextEditorState, type TextEditorState } from '../text-editor-layout';

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function useTextEditorSession({
  readOnly,
  textEditor,
  setTextEditor,
  textEditorRef,
  textEditorFocusKeyRef,
  textEditSnapshotRef,
  stageRef,
  containerRef,
  zoom,
  pan,
  levelObjects,
  setSelection,
  setInlineTextEditorActive,
}: {
  readOnly: boolean;
  textEditor: TextEditorState | null;
  setTextEditor: Dispatch<SetStateAction<TextEditorState | null>>;
  textEditorRef: RefObject<HTMLTextAreaElement | null>;
  textEditorFocusKeyRef: MutableRefObject<string | null>;
  textEditSnapshotRef: MutableRefObject<string | null>;
  stageRef: RefObject<Konva.Stage | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: { x: number; y: number };
  levelObjects: EventMapObjectDTO[];
  setSelection: (selection: MapSelectionItem | MapSelection | null) => void;
  setInlineTextEditorActive: (active: boolean) => void;
}) {
  useEffect(() => {
    if (!textEditor) {
      textEditorFocusKeyRef.current = null;
      textEditSnapshotRef.current = null;
      return;
    }

    const textarea = textEditorRef.current;
    if (!textarea) return;
    const focusKey = `${textEditor.objectId ?? 'new'}:${textEditor.left}:${textEditor.top}:${textEditor.textMode}`;
    if (textEditorFocusKeyRef.current === focusKey) return;

    textEditorFocusKeyRef.current = focusKey;
    textarea.focus();
    if (textEditor.objectId && textEditor.value) textarea.select();
  }, [
    textEditSnapshotRef,
    textEditor?.left,
    textEditor?.objectId,
    textEditor?.textMode,
    textEditor?.top,
    textEditor?.value,
    textEditorFocusKeyRef,
    textEditorRef,
  ]);

  useEffect(() => {
    if (!textEditor) return;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;

    const node = textEditor.objectId ? stage.findOne(`#node-${textEditor.objectId}`) : null;
    setTextEditor((current) => {
      if (!current) return current;
      return buildTextEditorState({
        objectId: current.objectId,
        value: current.value,
        mapX: current.mapX,
        mapY: current.mapY,
        mapWidth: current.mapWidth,
        mapHeight: current.mapHeight,
        textMode: current.textMode,
        rotation: current.rotation,
        baseFontSize: current.baseFontSize,
        fontFamily: current.fontFamily,
        fontWeight: current.fontWeight,
        letterSpacing: current.letterSpacing,
        color: current.color,
        lineHeight: current.lineHeight,
        textAlign: current.textAlign,
        stage,
        container,
        zoom,
        pan,
        node: node instanceof Konva.Text ? node : null,
      });
    });
  }, [containerRef, pan, pan.x, pan.y, setTextEditor, stageRef, textEditor?.objectId, textEditor?.textMode, textEditor?.value, zoom]);

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

      textEditSnapshotRef.current = String(object.data.text ?? '');
      const groupItems = resolveGroupSelectionItem({ type: 'object', id: object.id }, levelObjects);
      setSelection(groupItems.length > 1 ? groupItems : replaceSelection({ type: 'object', id: object.id }));
      setInlineTextEditorActive(true);
      setTextEditor(
        buildTextEditorState({
          objectId: object.id,
          value: String(object.data.text ?? ''),
          mapX: object.x,
          mapY: object.y,
          mapWidth: typeof object.width === 'number' ? object.width : null,
          mapHeight: typeof object.height === 'number' ? object.height : null,
          textMode: getTextMode(object),
          rotation: object.rotation ?? 0,
          baseFontSize: Number(object.data.fontSize ?? 22),
          fontFamily: String(object.data.fontFamily ?? 'Inter, sans-serif'),
          fontWeight: String(object.data.fontWeight ?? 'normal'),
          letterSpacing: Number(object.data.letterSpacing ?? 0),
          color: String(object.data.fill ?? '#0f172a'),
          lineHeight: Number(object.data.lineHeight ?? 1.2),
          textAlign: String(object.data.align ?? 'left') as TextEditorState['textAlign'],
          stage,
          container,
          zoom,
          pan,
          node,
        }),
      );
    }

    window.addEventListener('keydown', onEnterEdit);
    return () => window.removeEventListener('keydown', onEnterEdit);
  }, [
    containerRef,
    levelObjects,
    pan,
    readOnly,
    setInlineTextEditorActive,
    setSelection,
    setTextEditor,
    stageRef,
    textEditSnapshotRef,
    textEditor?.objectId,
    zoom,
  ]);
}
