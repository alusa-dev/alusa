"use client"

import * as React from "react"
import { format, parse, isValid as isValidFn } from "date-fns"
import type { Matcher } from "react-day-picker"
import { ptBR } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import { XMarkIcon } from "@heroicons/react/24/outline"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerBaseProps {
  /** Data selecionada */
  /** Placeholder quando não há data selecionada */
  placeholder?: string
  /** Classes CSS adicionais para o trigger */
  className?: string
  /** Se o componente está desabilitado */
  disabled?: boolean
  /** ID para associação com label */
  id?: string
  /** Formato de exibição da data */
  dateFormat?: string
  /** Variante do trigger: "button" (padrão) ou "input" */
  variant?: "button" | "input"
  /** Ano inicial do dropdown (padrão: ano atual - 10) */
  fromYear?: number
  /** Ano final do dropdown (padrão: ano atual + 10) */
  toYear?: number
  /** Se deve mostrar o ícone de calendário no botão */
  showIcon?: boolean
  /** Data mínima permitida */
  minDate?: Date
  /** Data máxima permitida */
  maxDate?: Date
  /** Marca visualmente o campo como inválido */
  invalid?: boolean
  /** Id de elemento descritivo para acessibilidade */
  describedBy?: string
  /** Regras extras de datas desabilitadas */
  disabledDays?: Matcher | Matcher[]
  /** Se o campo não permite digitação manual */
  readOnlyInput?: boolean
  /** Callback ao remover uma data em modo múltiplo */
  onRemoveDate?: (date: Date) => void
}

interface SingleDatePickerProps extends DatePickerBaseProps {
  mode?: "single"
  value?: Date | string
  onChange?: (date: Date | undefined) => void
}

interface MultipleDatePickerProps extends DatePickerBaseProps {
  mode: "multiple"
  value?: Array<Date | string>
  onChange?: (dates: Date[] | undefined) => void
}

export type DatePickerProps = SingleDatePickerProps | MultipleDatePickerProps

function coerceToDate(value: Date | string | undefined, dateFormat: string): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return isValidFn(value) ? value : undefined

  const trimmed = value.trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    try {
      const parsed = parse(trimmed, dateFormat, new Date(), { locale: ptBR })
      if (isValidFn(parsed)) return parsed
    } catch {
      // ignore
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number)
    const parsed = new Date(year, month - 1, day)
    if (isValidFn(parsed)) return parsed
  }

  const asDate = new Date(trimmed)
  return isValidFn(asDate) ? asDate : undefined
}

function coerceToDateList(value: Array<Date | string> | undefined, dateFormat: string): Date[] {
  if (!value?.length) return []

  const unique = new Map<number, Date>()

  for (const item of value) {
    const coerced = coerceToDate(item, dateFormat)
    if (!coerced) continue

    const normalized = startOfDay(coerced)
    unique.set(normalized.getTime(), normalized)
  }

  return Array.from(unique.values()).sort((left, right) => left.getTime() - right.getTime())
}

function formatDisplayDate(date: Date | string | undefined, dateFormat: string): string {
  if (!date) return ""

  // Se já for Date válido
  if (date instanceof Date) {
    if (!isValidFn(date)) return ""
    return format(date, dateFormat, { locale: ptBR })
  }

  // Se for string no formato dd/MM/yyyy, tenta parsear
  if (typeof date === "string") {
    const trimmed = date.trim()
    // formato dd/MM/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      try {
        const parsed = parse(trimmed, dateFormat, new Date(), { locale: ptBR })
        if (isValidFn(parsed)) return format(parsed, dateFormat, { locale: ptBR })
      } catch (err) {
        // ignore
      }
    }

    // tenta ISO ou construtor Date
    const iso = new Date(trimmed)
    if (isValidFn(iso)) return format(iso, dateFormat, { locale: ptBR })
  }

  return ""
}

function isValidDate(date: Date | undefined): boolean {
  if (!date) return false
  return !isNaN(date.getTime())
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isWithinRange(date: Date, minDate?: Date, maxDate?: Date) {
  const current = startOfDay(date).getTime()
  if (minDate && current < startOfDay(minDate).getTime()) return false
  if (maxDate && current > startOfDay(maxDate).getTime()) return false
  return true
}

function DatePicker({
  mode = "single",
  value,
  onChange,
  placeholder = "Selecione uma data",
  className,
  disabled = false,
  id,
  dateFormat = "dd/MM/yyyy",
  variant = "button",
  fromYear,
  toYear,
  showIcon = true,
  minDate,
  maxDate,
  invalid = false,
  describedBy,
  disabledDays,
  readOnlyInput = false,
  onRemoveDate,
}: DatePickerProps) {
  const singleValue = (mode === "multiple" ? undefined : value) as SingleDatePickerProps["value"]
  const multipleValue = (mode === "multiple" ? value : undefined) as MultipleDatePickerProps["value"]
  const singleOnChange = (mode === "multiple" ? undefined : onChange) as SingleDatePickerProps["onChange"]
  const multipleOnChange = (mode === "multiple" ? onChange : undefined) as MultipleDatePickerProps["onChange"]
  const [open, setOpen] = React.useState(false)
  const [hoveredScrollEdge, setHoveredScrollEdge] = React.useState<"left" | "right" | null>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const multiScrollRef = React.useRef<HTMLDivElement | null>(null)
  const selectedDates = React.useMemo(
    () => (mode === "multiple" ? coerceToDateList(multipleValue, dateFormat) : []),
    [dateFormat, mode, multipleValue]
  )
  const selectedDate = mode === "multiple" ? undefined : coerceToDate(singleValue, dateFormat)
  const [month, setMonth] = React.useState<Date | undefined>(
    (mode === "multiple" ? selectedDates[0] : selectedDate) ?? new Date()
  )
  const [inputValue, setInputValue] = React.useState(
    mode === "multiple" ? "" : formatDisplayDate(singleValue, dateFormat)
  )
  const isOutOfRange = selectedDate ? !isWithinRange(selectedDate, minDate, maxDate) : false
  const isInvalid = invalid || isOutOfRange
  const calendarDisabled = React.useMemo(() => {
    const extraDisabled = disabledDays
      ? Array.isArray(disabledDays)
        ? disabledDays
        : [disabledDays]
      : []

    if (minDate && maxDate) {
      return [{ before: startOfDay(minDate) }, { after: startOfDay(maxDate) }, ...extraDisabled]
    }
    if (minDate) {
      return [{ before: startOfDay(minDate) }, ...extraDisabled]
    }
    if (maxDate) {
      return [{ after: startOfDay(maxDate) }, ...extraDisabled]
    }
    return extraDisabled.length ? extraDisabled : undefined
  }, [disabledDays, minDate, maxDate])

  // Calcula range de anos padrão (10 anos para trás e para frente)
  const currentYear = new Date().getFullYear()
  const startMonth = fromYear ? new Date(fromYear, 0) : new Date(currentYear - 10, 0)
  const endMonth = toYear ? new Date(toYear, 11) : new Date(currentYear + 10, 11)

  // Sincroniza o input quando o value externo muda
  React.useEffect(() => {
    if (mode === "multiple") {
      if (selectedDates[0]) setMonth(selectedDates[0])
      return
    }

    setInputValue(formatDisplayDate(singleValue, dateFormat))
    const coerced = coerceToDate(singleValue, dateFormat)
    if (coerced) setMonth(coerced)
  }, [singleValue, dateFormat, mode, selectedDates])

  const updateMultiScrollState = React.useCallback(() => {
    const node = multiScrollRef.current
    if (!node) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }

    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth)
    setCanScrollLeft(node.scrollLeft > 0)
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 1)
  }, [])

  React.useEffect(() => {
    if (mode !== "multiple") {
      return
    }

    updateMultiScrollState()

    const node = multiScrollRef.current
    if (!node) {
      return
    }

    const handleResize = () => updateMultiScrollState()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [mode, selectedDates, updateMultiScrollState])

  React.useEffect(() => {
    if (mode !== "multiple" || !hoveredScrollEdge) {
      return
    }

    const node = multiScrollRef.current
    if (!node) {
      return
    }

    const step = hoveredScrollEdge === "right" ? 10 : -10
    const intervalId = window.setInterval(() => {
      node.scrollLeft += step
      updateMultiScrollState()
    }, 16)

    return () => window.clearInterval(intervalId)
  }, [hoveredScrollEdge, mode, updateMultiScrollState])

  const handleSelect = (date: Date | undefined) => {
    if (date && !isWithinRange(date, minDate, maxDate)) {
      return
    }
    singleOnChange?.(date)
    setInputValue(formatDisplayDate(date, dateFormat))
    setOpen(false)
  }

  const handleMultipleSelect = (dates: Date[] | undefined) => {
    if (mode !== "multiple") {
      return
    }

    const nextDates = (dates ?? [])
      .map((date) => startOfDay(date))
      .filter((date) => isWithinRange(date, minDate, maxDate))
      .sort((left, right) => left.getTime() - right.getTime())

    multipleOnChange?.(nextDates.length ? nextDates : undefined)

    if (nextDates[0]) {
      setMonth(nextDates[nextDates.length - 1])
    }
  }

  // Aplica máscara enquanto o usuário digita (dd/MM/yyyy)
  function maskDateInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 8)
    if (digits.length <= 2) return digits
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    const masked = maskDateInput(val)
    setInputValue(masked)

    // Se a máscara já estiver completa, tenta parsear e disparar onChange
    if (masked.length === 10) {
      try {
        const parsed = parse(masked, dateFormat, new Date(), { locale: ptBR })
        if (isValidFn(parsed) && isWithinRange(parsed, minDate, maxDate)) {
          singleOnChange?.(parsed)
          setMonth(parsed)
        }
      } catch (err) {
        // ignore parse errors
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
    }
  }

  const handleMultiTriggerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (!disabled) {
        setOpen(true)
      }
    }
  }

  const handleMultiScrollLeave = () => {
    setHoveredScrollEdge(null)
  }

  if (variant === "input" && mode === "multiple") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            id={id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-describedby={describedBy}
            aria-invalid={isInvalid || undefined}
            aria-disabled={disabled || undefined}
            onKeyDown={handleMultiTriggerKeyDown}
            className={cn(
              className,
              "relative flex h-10 w-full cursor-pointer items-center overflow-hidden rounded-lg border border-slate-200 bg-white px-3 pr-11 text-left text-sm text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30",
              disabled && "cursor-not-allowed bg-slate-50 text-slate-400",
              isInvalid && "border-red-300 text-red-700 focus-visible:ring-red-500/20"
            )}
            onMouseLeave={handleMultiScrollLeave}
          >
            <div
              ref={multiScrollRef}
              onScroll={updateMultiScrollState}
              className="flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex min-w-max items-center gap-1.5 whitespace-nowrap py-1.5">
                {selectedDates.length ? (
                  selectedDates.map((date) => {
                    const label = format(date, dateFormat, { locale: ptBR })

                    return (
                      <span
                        key={date.toISOString()}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#EEE7FF] px-2.5 py-1 text-xs font-medium text-[#6F42C1]"
                        title={label}
                      >
                        {label}
                        {!disabled && onRemoveDate ? (
                          <button
                            type="button"
                            aria-label={`Remover ${label}`}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              onRemoveDate(date)
                            }}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-[#7E57C2] transition hover:bg-[#E2D5FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30"
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        ) : null}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-slate-400">{placeholder}</span>
                )}
              </div>
            </div>

            {canScrollLeft ? (
              <div
                aria-hidden="true"
                onMouseEnter={() => setHoveredScrollEdge("left")}
                className="absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white via-white/90 to-transparent"
              />
            ) : null}

            {canScrollRight ? (
              <div
                aria-hidden="true"
                onMouseEnter={() => setHoveredScrollEdge("right")}
                className="absolute inset-y-0 right-11 z-10 w-8 bg-gradient-to-l from-white via-white/90 to-transparent"
              />
            ) : null}

            {showIcon ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                <CalendarIcon className="h-4 w-4" />
              </span>
            ) : null}
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto overflow-hidden p-0"
          align="end"
          alignOffset={-8}
          sideOffset={10}
        >
          <Calendar
            mode="multiple"
            selected={selectedDates}
            disabled={calendarDisabled}
            captionLayout="dropdown"
            month={month}
            onMonthChange={setMonth}
            onSelect={handleMultipleSelect}
            startMonth={startMonth}
            endMonth={endMonth}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // Variante com Input
  if (variant === "input") {
    return (
      <div className="relative w-full">
        <Input
          id={id}
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={isInvalid || undefined}
          className={cn(
            "pr-11",
            isInvalid && "border-red-300 text-red-700 focus-visible:ring-red-500/20",
            className
          )}
          onChange={handleInputChange}
          inputMode="numeric"
          maxLength={10}
          onKeyDown={handleKeyDown}
          readOnly={readOnlyInput}
        />
        {showIcon && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 rounded-md p-0 text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-700"
              >
                <CalendarIcon className="h-4 w-4" />
                <span className="sr-only">Selecionar data</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto overflow-hidden p-0"
              align="end"
              alignOffset={-8}
              sideOffset={10}
            >
              <Calendar
                mode="single"
                selected={selectedDate}
                disabled={calendarDisabled}
                captionLayout="dropdown"
                month={month}
                onMonthChange={setMonth}
                onSelect={handleSelect}
                startMonth={startMonth}
                endMonth={endMonth}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    )
  }

  // Variante padrão com Button
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={isInvalid || undefined}
          data-empty={!selectedDate}
          className={cn(
            "w-full justify-start text-left font-normal",
            "data-[empty=true]:text-muted-foreground",
            isInvalid && "border-red-300 text-red-700 hover:bg-red-50 focus-visible:ring-red-500/20",
            className
          )}
        >
          {showIcon && <CalendarIcon className="mr-2 h-4 w-4" />}
          {selectedDate ? (
            format(selectedDate, dateFormat, { locale: ptBR })
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          disabled={calendarDisabled}
          captionLayout="dropdown"
          month={month}
          onMonthChange={setMonth}
          onSelect={handleSelect}
          startMonth={startMonth}
          endMonth={endMonth}
        />
      </PopoverContent>
    </Popover>
  )
}

DatePicker.displayName = "DatePicker"

export { DatePicker }
