import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import type { TextEditorState } from '../../render/text-editor-layout';
import { useMapTextEditorCommit } from '../use-map-text-editor-commit';

function createNewTextEditor(): TextEditorState {
  return {
    objectId: null,
    value: 'Novo texto',
    mapX: 20,
    mapY: 30,
    mapWidth: null,
    mapHeight: null,
    textMode: 'auto',
    rotation: 0,
    left: 20,
    top: 30,
    width: 'auto',
    height: 'auto',
    minHeight: 24,
    fontSize: 22,
    baseFontSize: 22,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 'normal',
    letterSpacing: 0,
    color: '#0f172a',
    lineHeight: 1.2,
    textAlign: 'left',
  };
}

function setup() {
  let nextId = 0;
  const addObjectAt = vi.fn(() => `new-text-${++nextId}`);
  const updateObject = vi.fn();
  const setTool = vi.fn();
  const { result } = renderHook(() => {
    const [textEditor, setTextEditor] = useState<TextEditorState | null>(createNewTextEditor());
    const textEditorFocusKeyRef = useRef<string | null>('new:20:30:auto');
    return {
      ...useMapTextEditorCommit({
        textEditor,
        textEditSnapshotRef: { current: null },
        textEditorFocusKeyRef,
        map: null,
        setTool,
        setTextEditor,
        setInlineTextEditorActive: vi.fn(),
        addObjectAt,
        updateObject,
        deleteObject: vi.fn(),
      }),
      setTextEditor,
      textEditorFocusKeyRef,
    };
  });

  return { result, addObjectAt, updateObject, setTool };
}

describe('useMapTextEditorCommit', () => {
  it('clears the focus key between consecutive new text editors, including at the same position', () => {
    const { result, addObjectAt, updateObject } = setup();

    act(() => result.current.commitTextEditor());

    expect(addObjectAt).toHaveBeenCalledTimes(1);
    expect(updateObject).toHaveBeenCalledOnce();
    expect(result.current.textEditorFocusKeyRef.current).toBeNull();

    act(() => result.current.setTextEditor(createNewTextEditor()));
    act(() => result.current.commitTextEditor());

    expect(addObjectAt).toHaveBeenCalledTimes(2);
    expect(updateObject).toHaveBeenCalledTimes(2);
    expect(result.current.textEditorFocusKeyRef.current).toBeNull();
  });

  it('commits the text and switches to selection when the editor loses focus', () => {
    const { result, addObjectAt, setTool } = setup();

    act(() => result.current.handleTextEditorBlur());

    expect(addObjectAt).toHaveBeenCalledOnce();
    expect(setTool).toHaveBeenCalledWith('select');
  });
});
