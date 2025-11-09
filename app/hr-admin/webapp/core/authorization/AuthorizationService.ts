/**
 * User roles for the HR Admin application
 */
export enum UserRole {
  HRAdmin = "HRAdmin",
  HRViewer = "HRViewer",
  HREditor = "HREditor",
}

/**
 * Cached user information
 */
interface UserInfo {
  roles: string[];
  attributes: Record<string, string[]>;
  isAdmin: boolean;
  isViewer: boolean;
  isEditor: boolean;
}

let userInfoCache: UserInfo | null = null;

/**
 * Authorization Service for frontend permission checks
 *
 * NOTE: This is a stub implementation. Frontend authorization checks are optional
 * UX enhancements - all actual security is enforced by the backend.
 *
 * To implement user role detection, you would typically:
 * 1. Call a custom backend endpoint that returns user info
 * 2. Parse the JWT token from the OData model's security context
 * 3. Use the SAPUI5 UserInfo API (if available in your environment)
 *
 * See FRONTEND_AUTHORIZATION.md for complete implementation guide.
 */
export class AuthorizationService {
  /**
   * Fetch user information from the backend
   *
   * This is a stub implementation that defaults to allowing all operations.
   * Replace this with actual user info retrieval based on your setup.
   */
  private static async fetchUserInfo(): Promise<UserInfo> {
    if (userInfoCache) {
      return userInfoCache;
    }

    // TODO: Implement actual user role detection
    // Options:
    // 1. Call a backend endpoint: GET /user-info
    // 2. Parse user attributes from OData model security token
    // 3. Use SAPUI5 UserInfo API if available

    // For now, return least-privileged defaults (viewer-only)
    // This ensures the frontend doesn't break while backend enforces security
    console.warn("AuthorizationService: Using default read-only permissions. Implement fetchUserInfo() for role-based UI controls.");

    userInfoCache = {
      roles: [UserRole.HRViewer], // Default to least-privileged (viewer) for security
      attributes: {},
      isAdmin: false,
      isViewer: true,
      isEditor: false,
    };

    return userInfoCache;
  }

  /**
   * Check if user has a specific role
   */
  public static async hasRole(role: UserRole): Promise<boolean> {
    const userInfo = await this.fetchUserInfo();
    return userInfo.roles.includes(role);
  }

  /**
   * Check if user can create/update/delete entities
   */
  public static async canWrite(): Promise<boolean> {
    const userInfo = await this.fetchUserInfo();
    return userInfo.isAdmin || userInfo.isEditor;
  }

  /**
   * Check if user is admin (full access)
   */
  public static async isAdmin(): Promise<boolean> {
    const userInfo = await this.fetchUserInfo();
    return userInfo.isAdmin;
  }

  /**
   * Check if user is read-only (viewer)
   */
  public static async isReadOnly(): Promise<boolean> {
    const userInfo = await this.fetchUserInfo();
    return userInfo.isViewer && !userInfo.isEditor && !userInfo.isAdmin;
  }

  /**
   * Clear the user info cache (useful for logout or user switch)
   */
  public static clearCache(): void {
    userInfoCache = null;
  }
}
