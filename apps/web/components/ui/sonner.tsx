"use client"

import { usePathname } from "next/navigation"
import { useTheme } from "@/components/theme/ThemeProvider"
import { Toaster as Sonner } from "sonner"
import { cn } from "@/lib/utils"

type ToasterProps = React.ComponentProps<typeof Sonner>

const AUTH_CENTERED_TOAST_ROUTES = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
])

const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useTheme()
  const pathname = usePathname()
  const isAuthCenteredToast = pathname ? AUTH_CENTERED_TOAST_ROUTES.has(pathname) : false

  return (
    <Sonner
      theme={(isDark ? "dark" : "light") as ToasterProps["theme"]}
      className={cn("toaster group", isAuthCenteredToast && "auth-toaster")}
      position={isAuthCenteredToast ? "top-center" : "top-right"}
      offset={0}
      style={
        isAuthCenteredToast
          ? undefined
          : { top: '124px', right: 'var(--app-toast-right-offset, 24px)' }
      }
      gap={10}
      toastOptions={{
        style: isAuthCenteredToast ? undefined : { right: 0, left: 'auto' },
        classNames: {
          toast: cn(
            "group toast !w-fit group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            isAuthCenteredToast ? "!mx-auto" : "!right-0 !left-auto !ml-auto"
          ),
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }