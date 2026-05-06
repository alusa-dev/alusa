"use client"

import * as React from "react"
import { format, parse, isValid as isValidFn } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DatePickerProps {
  /** Data selecionada */
  value?: Date | string
  /** Callback quando a data muda */
  onChange?: (date: Date | undefined) => void
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
}

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
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date | undefined>(coerceToDate(value, dateFormat) ?? new Date())
  const [inputValue, setInputValue] = React.useState(formatDisplayDate(value, dateFormat))
  const selectedDate = coerceToDate(value, dateFormat)
  const isOutOfRange = selectedDate ? !isWithinRange(selectedDate, minDate, maxDate) : false
  const isInvalid = invalid || isOutOfRange
  const calendarDisabled = React.useMemo(() => {
    if (minDate && maxDate) {
      return [{ before: startOfDay(minDate) }, { after: startOfDay(maxDate) }]
    }
    if (minDate) {
      return { before: startOfDay(minDate) }
    }
    if (maxDate) {
      return { after: startOfDay(maxDate) }
    }
    return undefined
  }, [minDate, maxDate])

  // Calcula range de anos padrão (10 anos para trás e para frente)
  const currentYear = new Date().getFullYear()
  const startMonth = fromYear ? new Date(fromYear, 0) : new Date(currentYear - 10, 0)
  const endMonth = toYear ? new Date(toYear, 11) : new Date(currentYear + 10, 11)

  // Sincroniza o input quando o value externo muda
  React.useEffect(() => {
    setInputValue(formatDisplayDate(value, dateFormat))
    const coerced = coerceToDate(value, dateFormat)
    if (coerced) setMonth(coerced)
  }, [value, dateFormat])

  const handleSelect = (date: Date | undefined) => {
    if (date && !isWithinRange(date, minDate, maxDate)) {
      return
    }
    onChange?.(date)
    setInputValue(formatDisplayDate(date, dateFormat))
    setOpen(false)
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
          onChange?.(parsed)
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
            "pr-10",
            isInvalid && "border-red-300 text-red-700 focus-visible:ring-red-500/20",
            className
          )}
          onChange={handleInputChange}
          inputMode="numeric"
          maxLength={10}
          onKeyDown={handleKeyDown}
        />
        {showIcon && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                className="absolute top-1/2 right-2 -translate-y-1/2 p-0 h-auto w-auto bg-transparent hover:bg-transparent shadow-none"
              >
                <CalendarIcon className="h-4 w-4 text-gray-600" />
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
