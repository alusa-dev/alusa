import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EventSeatDTO } from '../../api/event-map-service';
import { LooseSeatNode } from '../LooseSeatNode';

vi.mock('react-konva', () => ({
  Circle: () => null,
  Group: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  Text: ({
    height,
    text,
    verticalAlign,
    y,
  }: {
    height: number;
    text: string;
    verticalAlign: string;
    y: number;
  }) => React.createElement('span', {
    'data-testid': 'seat-label',
    'data-height': height,
    'data-vertical-align': verticalAlign,
    'data-y': y,
  }, text),
}));

const seat: EventSeatDTO = {
  id: 'seat-43',
  levelId: 'level-1',
  sectionId: 'section-1',
  objectId: null,
  rowIndex: 0,
  columnIndex: 0,
  technicalCode: 'G43',
  displayLabel: '43',
  rowLabel: 'G',
  seatNumber: '43',
  status: 'AVAILABLE',
  accessible: false,
  publicVisible: true,
  x: 100,
  y: 100,
  size: 30,
  rotation: 0,
};

describe('LooseSeatNode label alignment', () => {
  it('centers the label in the full seat circle bounds', () => {
    render(
      React.createElement(LooseSeatNode, {
        seat,
        selection: [],
        parametricOwner: null,
        placementToolActive: false,
        readOnly: true,
        tool: 'select',
        onSelect: vi.fn(),
        onDoubleClickSelectIndividual: vi.fn(),
        onDragStart: vi.fn(),
        onDragMove: vi.fn(),
        onDragEnd: vi.fn(),
        onCommitPosition: vi.fn(),
      }),
    );

    const label = screen.getByTestId('seat-label');
    expect(label).toHaveAttribute('data-y', '-15');
    expect(label).toHaveAttribute('data-height', '30');
    expect(label).toHaveAttribute('data-vertical-align', 'middle');
    expect(label).toHaveTextContent('43');
  });
});
