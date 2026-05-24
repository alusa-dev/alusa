export type ID = string;

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Coluna-major: [a, b, c, d, e, f]
// | a  c  e |
// | b  d  f |
// | 0  0  1 |
export type Matrix2D = [
  number, number,
  number, number,
  number, number,
];

export type Transform2D = {
  x: number;
  y: number;
  // graus (compatível com Konva/CSS); converta para radianos antes de createMatrix
  rotation: number;
  scaleX: number;
  scaleY: number;
};
