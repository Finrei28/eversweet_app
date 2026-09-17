/**
 * The longest each profile field may be. The server refuses anything longer
 * (backend/src/utils/schema.ts, PROFILE_FIELD_LIMITS); capping the inputs at the same
 * lengths stops the app sending a form that can only be turned away.
 */
export const PROFILE_FIELD_MAX_LENGTH = {
  email: 254,
  firstName: 50,
  lastName: 50,
  phone: 20,
} as const
