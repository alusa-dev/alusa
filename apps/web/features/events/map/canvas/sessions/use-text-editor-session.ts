'use client';

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useEffect } from 'react';
import Konva from 'konva';
import { buildTextEditorState, type TextEditorState } from '../render/text-editor-layout';

export function useTextEditorSession({
  textEditor,
  setTextEditor,
  textEditorRef,
  textEditorFocusKeyRef,
  stageRef,
  containerRef,
  zoom,
  pan,
}: {
  textEditor: TextEditorState | null;
  setTextEditor: Dispatch<SetStateAction<TextEditorState | null>>;
  textEditorRef: RefObject<HTMLTextAreaElement | null>;
  textEditorFocusKeyRef: MutableRefObject<string | null>;
  stageRef: RefObject<Konva.Stage | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: { x: number; y: number };
}) {
  useEffect(() => {
    if (!textEditor) {
      textEditorFocusKeyRef.current = null;
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
}
