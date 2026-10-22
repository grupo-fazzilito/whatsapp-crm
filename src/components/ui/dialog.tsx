"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "modal-backdrop-in fixed inset-0 isolate z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

// Every modal opens as a panel from the right (same look as Sheet), full
// height. The panel scrolls; DialogHeader sticks to the top and
// DialogFooter to the bottom, so the title and the actions never leave
// the screen however long the content is.

/**
 * Classes of the old centered modals that the side panel ignores: layout
 * (size, position, padding, scroll) and colors, so every modal looks the
 * same. Width classes (sm:max-w-*) are kept.
 */
const CENTERED_LAYOUT =
  /^(?:max-h-|min-h-|h-|overflow-|overscroll-|rounded|top-|left-|right-|bottom-|inset-|-?translate-|zoom-|p-|px-|py-|pt-|pb-|pl-|pr-|grid$|flex$|flex-col$|gap-|shadow|bg-|border|text-|ring)/

function panelClasses(className: string | undefined): string {
  return (className ?? "")
    .split(/\s+/)
    .filter((c) => c && !CENTERED_LAYOUT.test(c.replace(/^[a-z0-9-]+:/, "")))
    .join(" ")
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "modal-in-right fixed inset-y-0 right-0 z-50 h-dvh w-full overflow-y-auto overscroll-contain border-l bg-popover text-sm text-popover-foreground shadow-2xl outline-none transition duration-200 ease-in-out data-ending-style:translate-x-10 data-ending-style:opacity-0 data-starting-style:translate-x-10 data-starting-style:opacity-0 sm:max-w-md",
          typeof className === "string" ? panelClasses(className) : className
        )}
        {...props}
      >
        {showCloseButton && (
          <div className="sticky top-0 z-20 flex h-0 justify-end">
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={
                <Button
                  variant="ghost"
                  className="mt-3 mr-3"
                  size="icon-sm"
                />
              }
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        )}
        {/* A form that holds the footer fills the panel so the footer sits at the bottom. */}
        <div
          data-slot="dialog-body"
          className="flex min-h-full flex-col gap-4 p-6 [&>form:has([data-slot=dialog-footer])]:flex [&>form:has([data-slot=dialog-footer])]:flex-1 [&>form:has([data-slot=dialog-footer])]:flex-col"
        >
          {children}
        </div>
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "sticky top-0 z-10 -mx-6 -mt-6 flex flex-col gap-2 border-b bg-popover px-6 pt-6 pb-4 pr-14",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 z-10 -mx-6 -mb-6 mt-auto flex flex-col-reverse gap-2 border-t bg-popover px-6 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
