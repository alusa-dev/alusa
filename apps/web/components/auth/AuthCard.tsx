"use client";
import type { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export default function AuthCard({ children, className, ...rest }: Props) {
  return (
    <div
      className={`mx-auto w-[420px] max-w-[92vw] rounded-[40px] bg-white p-10 shadow-[0_6px_24px_rgba(0,0,0,0.12)] flex flex-col items-center ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
}
