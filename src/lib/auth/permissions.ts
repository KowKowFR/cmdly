export type UserRole = "viewer" | "operator" | "admin";

// Higher index = more permissions
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

/**
 * Returns true if the user's role meets or exceeds the required role.
 * @param userRole - The role of the current user
 * @param requiredRole - The minimum role required to execute the tool
 */
export function canExecuteTool(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
