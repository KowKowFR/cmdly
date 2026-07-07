"use client";

import { toast } from "sonner";

/**
 * Thin wrapper over sonner providing `success` and `error` helpers.
 *
 * @example
 * const t = useToast();
 * t.success("Saved successfully");
 * t.error("Something went wrong");
 */
export function useToast() {
  return {
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    info: (message: string) => toast(message),
    warning: (message: string) => toast.warning(message),
  };
}
