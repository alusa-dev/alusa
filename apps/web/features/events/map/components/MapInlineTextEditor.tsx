import type { KeyboardEvent, Ref } from 'react';
import React from 'react';

import { TEXT_EDITOR_PLACEHOLDER } from '../canvas/render/text-editor-layout';
import type { TextEditorState } from '../canvas/render/text-editor-layout';

type MapInlineTextEditorProps = {
  textEditor: TextEditorState;
  textEditorRef: Ref<HTMLTextAreaElement | null>;
  textEditorDimensions: { width?: number; height?: number } | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function MapInlineTextEditor({
  textEditor,
  textEditorRef,
  textEditorDimensions,
  onChange,
  onBlur,
  onKeyDown,
}: MapInlineTextEditorProps) {
  return (
    <textarea
      data-testid="map-text-editor"
      ref={textEditorRef as React.Ref<HTMLTextAreaElement>}
      value={textEditor.value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={textEditor.value ? undefined : TEXT_EDITOR_PLACEHOLDER}
      onKeyDown={onKeyDown}
      style={{
        left: textEditor.left,
        top: textEditor.top,
        width: textEditorDimensions?.width,
        height: textEditorDimensions?.height,
        minHeight: textEditor.minHeight,
        fontSize: textEditor.fontSize,
        fontFamily: textEditor.fontFamily,
        fontWeight: textEditor.fontWeight === 'bold' ? 700 : 400,
        letterSpacing: textEditor.letterSpacing,
        lineHeight: textEditor.lineHeight,
        color: textEditor.color,
        textAlign: textEditor.textAlign,
        transform: textEditor.transform,
        transformOrigin: 'left top',
        whiteSpace: textEditor.textMode === 'auto' ? 'pre' : 'pre-wrap',
      }}
      wrap={textEditor.textMode === 'auto' ? 'off' : 'soft'}
      rows={1}
      className="absolute z-30 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 outline-none ring-0"
    />
  );
}
