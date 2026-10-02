"use client"

import type * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-3",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-9 p-0 aria-disabled:opacity-40"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-9 p-0 aria-disabled:opacity-40"
        ),
        month_caption: "flex h-9 items-center justify-center px-10",
        dropdowns: "flex items-center justify-center gap-1 text-sm font-semibold",
        dropdown_root:
          "relative inline-flex items-center rounded-lg has-focus:ring-[3px] has-focus:ring-ring/50",
        dropdown: "absolute inset-0 cursor-pointer opacity-0",
        caption_label:
          "flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold select-none",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "size-10 text-center text-xs leading-10 font-medium text-muted-foreground",
        week: "mt-1 flex",
        day: "group/day relative size-10 p-0 text-center text-sm",
        day_button:
          "size-10 rounded-xl font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:hover:bg-primary group-data-[today=true]/day:ring-1 group-data-[today=true]/day:ring-primary group-data-[disabled=true]/day:pointer-events-none",
        outside: "text-muted-foreground opacity-50",
        disabled: "opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClass, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", iconClass)} {...rest} />
          ) : orientation === "right" ? (
            <ChevronRight className={cn("size-4", iconClass)} {...rest} />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("size-3.5", iconClass)}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
