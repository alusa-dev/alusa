"use client"

import React from "react"
import { toast as sonnerToast } from "sonner"
import { cn } from "@/lib/utils"
import { Toaster } from "./sonner"

export { Toaster }

export type ToastVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error'

type ToastDescription = React.ReactNode
type ToastTitle = React.ReactNode

export interface ToastMessage {
  id?: string
  title?: ToastTitle
  description?: ToastDescription
  variant?: ToastVariant
  duration?: number
  actionLabel?: React.ReactNode
  onAction?: () => void
  onClose?: () => void
  dismissible?: boolean
}

type ToastOptions = Omit<ToastMessage, 'id' | 'title' | 'variant'>

const variantShellStyles: Record<ToastVariant, string> = {
  neutral: 'border-[#4f3a73] bg-[#2f2640] text-[#f7f3ff] shadow-lg shadow-[#2f2640]/25',
  success: 'border-[#256b48] bg-[#1f3a2d] text-[#f4fff8] shadow-lg shadow-[#1f3a2d]/25',
  error: 'border-[#8a3144] bg-[#3f2230] text-[#fff5f7] shadow-lg shadow-[#3f2230]/25',
  warning: 'border-[#8b6a22] bg-[#41331a] text-[#fff9eb] shadow-lg shadow-[#41331a]/25',
  info: 'border-[#3d4f78] bg-[#24324d] text-[#f5f9ff] shadow-lg shadow-[#24324d]/25',
}

const variantAccentStyles: Record<ToastVariant, string> = {
  neutral: 'bg-[#b9a3ff]',
  success: 'bg-[#4dd08b]',
  error: 'bg-[#ff6f91]',
  warning: 'bg-[#f4c95d]',
  info: 'bg-[#8eb8ff]',
}

const variantDescriptionStyles: Record<ToastVariant, string> = {
  neutral: 'text-[#d8cfee]',
  success: 'text-[#cdebd9]',
  error: 'text-[#f3d6dd]',
  warning: 'text-[#eadfb6]',
  info: 'text-[#d7e3ff]',
}

const variantActionStyles: Record<ToastVariant, string> = {
  neutral: 'border-[#5f4a84] bg-[#3a2d53] text-[#f7f3ff] hover:bg-[#463464]',
  success: 'border-[#317652] bg-[#29553f] text-[#f4fff8] hover:bg-[#31634b]',
  error: 'border-[#8f4760] bg-[#5a3040] text-[#ffe9ef] hover:bg-[#6a394c]',
  warning: 'border-[#92753a] bg-[#5d4b25] text-[#fff3cf] hover:bg-[#6d592d]',
  info: 'border-[#4b628f] bg-[#2f3d59] text-[#ebf2ff] hover:bg-[#39496c]',
}

const variantCloseStyles: Record<ToastVariant, string> = {
  neutral: 'text-[#d8cfee] hover:bg-[#463464] hover:text-[#f7f3ff]',
  success: 'text-[#cdebd9] hover:bg-[#31634b] hover:text-[#f4fff8]',
  error: 'text-[#f3d6dd] hover:bg-[#6a394c] hover:text-[#fff5f7]',
  warning: 'text-[#eadfb6] hover:bg-[#6d592d] hover:text-[#fff9eb]',
  info: 'text-[#d7e3ff] hover:bg-[#39496c] hover:text-[#f5f9ff]',
}

export function CustomToast({
  title,
  description,
  variant = 'neutral',
  actionLabel,
  onAction,
  onClose,
  dismissible = true,
}: ToastMessage) {
  const dataTestId = variant === 'success' ? 'toast-success' : variant === 'error' ? 'toast-error' : undefined

  return (
    <div
      data-custom-toast
      data-testid={dataTestId}
      className={cn(
        'animate-toast-panel pointer-events-auto relative ml-auto flex w-fit min-w-[260px] max-w-[360px] items-start gap-3 overflow-hidden rounded-xl border px-4 py-3 pr-10 transition-all duration-200 will-change-transform hover:scale-[1.015]',
        variantShellStyles[variant]
      )}
      role="status"
    >
      {dismissible ? (
        <button
          type="button"
          aria-label="Fechar notificação"
          onClick={onClose}
          className={cn(
            'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-200',
            variantCloseStyles[variant]
          )}
        >
          <span className="text-sm leading-none">x</span>
        </button>
      ) : null}

      <div className="relative flex shrink-0 items-stretch self-stretch py-0.5">
        <div className={cn('h-full min-h-10 w-[3px] rounded-full', variantAccentStyles[variant])} />
      </div>

      <div className="relative min-w-0 flex-1 space-y-0.5">
        {title ? (
          <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-current">
            {title}
          </h3>
        ) : null}
        {description ? (
          <div
            className={cn(
              'text-[13px] leading-5 break-words [&_*]:text-inherit',
              variantDescriptionStyles[variant]
            )}
          >
            {description}
          </div>
        ) : null}
      </div>

      {actionLabel && (
        <div className="relative ml-auto flex shrink-0 items-start gap-2 self-start pt-0.5">
          {actionLabel ? (
            <button
              type="button"
              onClick={onAction}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                variantActionStyles[variant]
              )}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function isRenderableNode(value: unknown): value is React.ReactNode {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    value === null ||
    value === undefined ||
    React.isValidElement(value)
  )
}

function normalizeToastInput(
  titleOrOptions?: ToastTitle | Omit<ToastMessage, 'id' | 'variant'>,
  options?: ToastOptions,
  variant?: ToastVariant,
): Omit<ToastMessage, 'id'> {
  if (
    titleOrOptions &&
    typeof titleOrOptions === 'object' &&
    !React.isValidElement(titleOrOptions) &&
    ('title' in titleOrOptions || 'description' in titleOrOptions || 'duration' in titleOrOptions)
  ) {
    return { variant: variant ?? 'neutral', ...titleOrOptions }
  }

  return {
    variant: variant ?? 'neutral',
    title: titleOrOptions as ToastTitle,
    ...(options ?? {}),
  }
}

function renderToast(message: Omit<ToastMessage, 'id'>) {
  return sonnerToast.custom(
    (id) => (
      <CustomToast
        {...message}
        onClose={() => {
          message.onClose?.()
          sonnerToast.dismiss(id)
        }}
      />
    ),
    { duration: message.duration }
  )
}

export function pushToast(message: Omit<ToastMessage, 'id'>) {
  return renderToast({ variant: 'neutral', ...message })
}

function createVariantMethod(variant: ToastVariant) {
  return (titleOrOptions?: ToastTitle | Omit<ToastMessage, 'id' | 'variant'>, options?: ToastOptions) => {
    if (React.isValidElement(titleOrOptions)) {
      return sonnerToast.custom(() => titleOrOptions, { duration: options?.duration })
    }

    if (isRenderableNode(titleOrOptions) || titleOrOptions === undefined) {
      return renderToast(normalizeToastInput(titleOrOptions, options, variant))
    }

    return renderToast({ variant, ...(titleOrOptions ?? {}), ...(options ?? {}) })
  }
}

export const toast = {
  success: createVariantMethod('success'),
  error: createVariantMethod('error'),
  warning: createVariantMethod('warning'),
  info: createVariantMethod('info'),
  message: createVariantMethod('neutral'),
  custom: sonnerToast.custom,
  dismiss: sonnerToast.dismiss,
}