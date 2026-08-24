/**
 * Safely extracts a readable string message from any thrown error object.
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  // Handle string errors (e.g., throw "Custom error string")
  if (typeof error === "string") {
    return error
  }

  // Handle backend/API specific error structures (e.g., Axios or Fetch error shapes)
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }

  return "Something went wrong. Please try again."
}
