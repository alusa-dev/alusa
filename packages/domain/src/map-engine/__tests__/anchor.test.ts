import {
  getFixedPointFromAnchor,
  getMovingAxes,
  getMovingEdgesFromAnchor,
  isCornerAnchor,
  isEdgeAnchor,
  isHorizontalEdgeAnchor,
} from '../geometry/anchor.js';

describe('geometry/anchor', () => {
  it('maps moving edges from anchor', () => {
    expect(getMovingEdgesFromAnchor('top-left')).toEqual({ vertical: 'start', horizontal: 'start' });
    expect(getMovingEdgesFromAnchor('middle-right')).toEqual({ vertical: 'end' });
  });

  it('classifies corner and edge anchors', () => {
    expect(isCornerAnchor('top-left')).toBe(true);
    expect(isCornerAnchor('middle-left')).toBe(false);
    expect(isHorizontalEdgeAnchor('middle-left')).toBe(true);
    expect(isEdgeAnchor('bottom-center')).toBe(true);
  });

  it('returns moving axes', () => {
    expect(getMovingAxes('bottom-center')).toEqual({ horizontal: true, vertical: false });
    expect(getMovingAxes('top-left')).toEqual({ horizontal: true, vertical: true });
  });

  it('resolves fixed point from anchor', () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(getFixedPointFromAnchor(box, 'top-left')).toEqual({ x: 100, y: 50 });
  });
});
