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

const variantClass: Record<ToastVariant, string> = {
  neutral: 'alusa-custom-toast alusa-custom-toast--neutral',
  success: 'alusa-custom-toast alusa-custom-toast--success',
  error: 'alusa-custom-toast alusa-custom-toast--error',
  warning: 'alusa-custom-toast alusa-custom-toast--warning',
  info: 'alusa-custom-toast alusa-custom-toast--info',
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
        variantClass[variant]
      )}
      role="status"
    >
      {dismissible ? (
        <button
          type="button"
          aria-label="Fechar notificação"
          onClick={onClose}
          className={cn(
            'alusa-custom-toast--close absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-200',
          )}
        >
          <span className="text-sm leading-none">x</span>
        </button>
      ) : null}

      <div className="relative flex shrink-0 items-stretch self-stretch py-0.5">
        <div className={cn('alusa-custom-toast--accent-bar h-full min-h-10 w-[3px]', 'rounded-full')} />
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
              'alusa-custom-toast--description text-[13px] leading-5 break-words [&_*]:text-inherit',
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
                'alusa-custom-toast--action rounded-lg border px-3 py-1.5 text-xs font-medium transition',
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
