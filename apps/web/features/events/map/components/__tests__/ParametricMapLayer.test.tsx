import { render, screen } from '@testing-library/react';
import type { EventMapDocument } from '@alusa/domain';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ParametricMapLayer } from '../ParametricMapLayer';

vi.mock('react-konva', () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Rect: () => null,
  Text: ({ id, text }: { id: string; text: string }) => <span data-testid={id}>{text}</span>,
}));

function createDocument(numberingMode: 'NUMERIC' | 'ALPHANUMERIC'): EventMapDocument {
  const rowLabel = 'A';
  return {
    schemaVersion: 1,
    visualElements: [],
    sections: [{
      id: 'section-1',
      levelId: 'level-1',
      name: 'Setor 1',
      color: '#123456',
      position: { x: 0, y: 0 },
      rotation: 0,
      outline: [],
      blockIds: ['block-1'],
      blocks: [{
        id: 'block-1',
        sectionId: 'section-1',
        numberingMode,
        rowGap: 0,
        defaultSeatGap: 0,
        distribution: [{ type: 'SEATS', count: 1 }],
        rowIds: ['row-1'],
        rows: [{
          id: 'row-1',
          sectionId: 'section-1',
          blockId: 'block-1',
          label: rowLabel,
          path: { type: 'LINE', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
          seatGap: 0,
          seatSize: 20,
          seatIds: ['seat-1'],
          seats: [{ id: 'seat-1', label: 'A1', rowIndex: 0, columnIndex: 0 }],
        }],
      }],
    }],
  };
}

function renderMap(numberingMode: 'NUMERIC' | 'ALPHANUMERIC') {
  const document = createDocument(numberingMode);
  render(
    <ParametricMapLayer
      document={document}
      levelId="level-1"
      selection={[]}
      readOnly
      onSelect={vi.fn()}
    />,
  );
  return document;
}

describe('ParametricMapLayer row labels', () => {
  it('hides the row label when seat numbering is numeric without changing the row data', () => {
    const document = renderMap('NUMERIC');

    expect(screen.queryByTestId('node-seatrow-label-row-1')).not.toBeInTheDocument();
    expect(document.sections[0]?.blocks[0]?.rows[0]?.label).toBe('A');
  });

  it('keeps the row label visible when seat numbering is alphanumeric', () => {
    renderMap('ALPHANUMERIC');

    expect(screen.getByTestId('node-seatrow-label-row-1')).toHaveTextContent('A');
  });
});
