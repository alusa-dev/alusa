export type IdGenerator = (prefix: string) => string;

export type Clock = {
  now(): string;
};

export type TextMeasurer = (input: {
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: string;
  letterSpacing?: number;
}) => number;

export type MapEngineRuntime = {
  createId?: IdGenerator;
  clock?: Clock;
  measureText?: TextMeasurer;
};
