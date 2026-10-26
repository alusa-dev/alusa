'use client';

import { useEffect } from 'react';
import {
  motion,
  type MotionValue,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

const spring = { stiffness: 280, damping: 18, mass: 0.3 } as const;

function Digit({ value, place }: { value: number; place: number }) {
  const reducedMotion = useReducedMotion() ?? false;
  const digit = Math.floor(value / place) % 10;
  const initialValue = useMotionValue(digit);
  const animatedValue = useSpring(initialValue, spring);

  useEffect(() => {
    const currentValue = animatedValue.get();
    const targetValue = digit + 10 * Math.round((currentValue - digit) / 10);
    if (reducedMotion) {
      animatedValue.jump(targetValue);
      return;
    }
    animatedValue.set(targetValue);
  }, [animatedValue, digit, reducedMotion]);

  return (
    <span className="sliding-number-digit" aria-hidden="true">
      {Array.from({ length: 10 }, (_, number) => (
        <DigitCell key={number} mv={animatedValue} number={number} />
      ))}
    </span>
  );
}

function DigitCell({ mv, number }: { mv: MotionValue<number>; number: number }) {
  const y = useTransform(mv, (latest) => {
    const offset = number - latest;
    const shortestOffset = offset - 10 * Math.round(offset / 10);
    return `${shortestOffset * 100}%`;
  });

  return (
    <motion.span className="sliding-number-cell" style={{ y }}>
      {number}
    </motion.span>
  );
}

export type SlidingNumberProps = {
  value: number;
  padStart?: boolean;
  decimalSeparator?: string;
};

export function SlidingNumber({
  value,
  padStart = false,
  decimalSeparator = '.',
}: SlidingNumberProps) {
  const absoluteValue = Math.abs(value);
  const [integerPart, decimalPart] = absoluteValue.toString().split('.');
  const integerValue = Number.parseInt(integerPart, 10);
  const paddedInteger = padStart && integerValue < 10 ? `0${integerPart}` : integerPart;
  const integerDigits = paddedInteger.split('');
  const decimalPlaces = decimalPart?.length ?? 0;
  const scaledValue = Number.parseInt(`${integerPart}${decimalPart ?? ''}`, 10);
  const integerPlaces = integerDigits.map((_, index) =>
    Math.pow(10, decimalPlaces + integerDigits.length - index - 1),
  );

  return (
    <span className="sliding-number" data-value={value} aria-hidden="true">
      {value < 0 && '-'}
      {integerDigits.map((_, index) => (
        <Digit key={`pos-${integerPlaces[index]}`} value={scaledValue} place={integerPlaces[index]} />
      ))}
      {decimalPart && (
        <>
          <span>{decimalSeparator}</span>
          {decimalPart.split('').map((_, index) => (
            <Digit
              key={`decimal-${index}`}
              value={scaledValue}
              place={Math.pow(10, decimalPart.length - index - 1)}
            />
          ))}
        </>
      )}
    </span>
  );
}
