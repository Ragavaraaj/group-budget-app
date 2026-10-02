"use client"

import { CalendarIcon, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** The app keeps dates as local `YYYY-MM-DD` text; these convert to and from a local Date. */
function parse(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function format(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const SHOWN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

interface DatePickerProps {
  /** Goes on the trigger button, so a `<Label htmlFor>` names it. */
  id?: string
  /** `YYYY-MM-DD`, or empty for none. */
  value: string
  onChange: (value: string) => void
  /** Earliest and latest pickable day, as `YYYY-MM-DD`. */
  min?: string
  max?: string
  placeholder?: string
  /** Offers a button to empty the field, for optional dates. */
  clearable?: boolean
  invalid?: boolean
  className?: string
}

/** A button showing the chosen day that opens a calendar to change it. */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  clearable = false,
  invalid,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parse(value)
  const earliest = min ? parse(min) : undefined
  const latest = max ? parse(max) : undefined
  const now = new Date()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid}
          className={cn(
            "h-11 w-full justify-between px-3 font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {selected ? SHOWN.format(selected) : placeholder}
          </span>
          <CalendarIcon className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={selected ?? latest ?? now}
          startMonth={earliest ?? new Date(now.getFullYear() - 10, 0)}
          endMonth={latest ?? new Date(now.getFullYear() + 5, 11)}
          disabled={[
            ...(earliest ? [{ before: earliest }] : []),
            ...(latest ? [{ after: latest }] : []),
          ]}
          onSelect={(day) => {
            if (!day) return
            onChange(format(day))
            setOpen(false)
          }}
        />
        {clearable && value ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              <X /> Clear date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
