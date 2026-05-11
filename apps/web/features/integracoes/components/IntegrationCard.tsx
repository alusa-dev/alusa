"use client";

import React from 'react';
import { cn } from "@/lib/cn";
import { ArrowUpRightIcon } from "@heroicons/react/24/outline";

export type IntegrationStatusVariant = "default" | "success" | "warning" | "error";

interface IntegrationCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  status: { label: string; variant?: IntegrationStatusVariant; helper?: string };
}

const statusColors: Record<IntegrationStatusVariant, string> = {
  default: "bg-[#E6E4EA] text-[#383242]",
  success: "bg-[#CFF2DA] text-[#144E22]",
  warning: "bg-[#F3F9B3] text-[#5A630F]",
  error: "bg-[#FFD9B3] text-[#5C2A00]",
};

export function IntegrationCard({ title, description, icon, onClick, status }: IntegrationCardProps) {
  const variant = status.variant ?? "default";
  const isDisabled = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "group flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-colors duration-200",
        isDisabled ? "cursor-default" : "hover:bg-gray-50"
      )}
    >
      <div className="flex items-center gap-4">
        <div className="h-11 w-11 rounded-lg bg-brand-accent flex items-center justify-center overflow-hidden">
          {icon}
        </div>
        <div>
          <p className="flex items-center gap-1 text-base font-semibold text-gray-900">
            {title}
            {isDisabled ? null : (
              <ArrowUpRightIcon className="h-4 w-4 text-gray-400 transition group-hover:text-brand-accent" />
            )}
          </p>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
      <div className="flex items-center text-right">
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusColors[variant])}>
          {status.label}
        </span>
      </div>
    </button>
  );
}
