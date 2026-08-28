const DEFAULT_FALLBACK = "Something went wrong. Please try again."

/**
 * Safely extracts a readable string message from any thrown error object.
 * `fallback` lets call sites supply a message specific to what failed,
 * used whenever no usable message can be found on `error`.
 */
export const getErrorMessage = (
  error: unknown,
  fallback: string = DEFAULT_FALLBACK,
): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  // Handle string errors (e.g., throw "Custom error string")
  if (typeof error === "string" && error.trim()) {
    return error
  }

  // Handle backend/API error response shapes, e.g. { message } or { error }
  if (error && typeof error === "object") {
    const { message, error: errorField } = error as {
      message?: unknown
      error?: unknown
    }

    if (typeof message === "string" && message.trim()) {
      return message
    }

    if (typeof errorField === "string" && errorField.trim()) {
      return errorField
    }
  }

  return fallback
}
