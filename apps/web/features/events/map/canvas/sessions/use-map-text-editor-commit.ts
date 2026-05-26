'use client';

import { getTextDimensionsForMode, normalizeTextData } from '@alusa/domain';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import type { MapTool } from '../../store/event-map-editor-store';
import type { TextEditorState } from '../render/text-editor-layout';

export function useMapTextEditorCommit({
  textEditor,
  textEditSnapshotRef,
  map,
  setTextEditor,
  setInlineTextEditorActive,
  addObjectAt,
  updateObject,
  deleteObject,
}: {
  textEditor: TextEditorState | null;
  textEditSnapshotRef: MutableRefObject<string | null>;
  map: EventMapDTO | null;
  setTextEditor: Dispatch<SetStateAction<TextEditorState | null>>;
  setInlineTextEditorActive: (active: boolean) => void;
  addObjectAt: (
    tool: MapTool,
    point: { x: number; y: number },
    size?: { width?: number; height?: number },
  ) => string | null;
  updateObject: (id: string, patch: Partial<EventMapObjectDTO>) => void;
  deleteObject: (id: string) => void;
}) {
  const commitTextEditor = useCallback(() => {
    if (!textEditor) return;
    if (!textEditor.value.trim()) {
      if (textEditor.objectId) deleteObject(textEditor.objectId);
      setInlineTextEditorActive(false);
      setTextEditor(null);
      return;
    }

    const dims = getTextDimensionsForMode(textEditor.textMode, textEditor.mapWidth, textEditor.mapHeight);
    const nextData = normalizeTextData({
      text: textEditor.value,
      label: textEditor.value,
      textMode: textEditor.textMode,
      fontSize: textEditor.baseFontSize,
      fontFamily: textEditor.fontFamily,
      fill: textEditor.color,
      lineHeight: textEditor.lineHeight,
      align: textEditor.textAlign,
    });

    if (!textEditor.objectId) {
      const createdId = addObjectAt(
        'text',
        { x: textEditor.mapX, y: textEditor.mapY },
        textEditor.textMode === 'auto'
          ? undefined
          : textEditor.textMode === 'fixed-width'
            ? { width: dims.width ?? 160 }
            : { width: dims.width ?? 160, height: dims.height ?? 60 },
      );
      if (!createdId) {
        setInlineTextEditorActive(false);
        setTextEditor(null);
        return;
      }
      updateObject(createdId, {
        width: dims.width,
        height: dims.height,
        data: nextData,
      });
      setInlineTextEditorActive(false);
      setTextEditor(null);
      return;
    }

    updateObject(textEditor.objectId, {
      width: dims.width,
      height: dims.height,
      data: {
        ...(map?.objects.find((object) => object.id === textEditor.objectId)?.data ?? {}),
        ...nextData,
      },
    });
    setInlineTextEditorActive(false);
    setTextEditor(null);
  }, [
    addObjectAt,
    deleteObject,
    map?.objects,
    setInlineTextEditorActive,
    setTextEditor,
    textEditor,
    updateObject,
  ]);

  const cancelTextEditor = useCallback(() => {
    if (!textEditor) return;
    if (textEditor.objectId && textEditSnapshotRef.current !== null) {
      updateObject(textEditor.objectId, {
        data: {
          ...(map?.objects.find((object) => object.id === textEditor.objectId)?.data ?? {}),
          text: textEditSnapshotRef.current,
          label: textEditSnapshotRef.current,
        },
      });
    }
    setInlineTextEditorActive(false);
    setTextEditor(null);
  }, [map?.objects, setInlineTextEditorActive, setTextEditor, textEditSnapshotRef, textEditor, updateObject]);

  const handleTextEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!textEditor) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelTextEditor();
        return;
      }
      if (textEditor.textMode === 'auto' && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitTextEditor();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        commitTextEditor();
      }
    },
    [cancelTextEditor, commitTextEditor, textEditor],
  );

  return {
    commitTextEditor,
    cancelTextEditor,
    handleTextEditorKeyDown,
  };
}
