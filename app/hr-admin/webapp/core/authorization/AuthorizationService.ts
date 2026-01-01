import Log from "sap/base/Log";

/**
 * User roles for the HR Admin application
 */
export enum UserRole {
  HRAdmin = 'HRAdmin',
  HRViewer = 'HRViewer',
  HREditor = 'HREditor',
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
 * NOTE: Frontend authorization checks are optional UX enhancements.
 * All actual security is enforced by the backend.
 *
 * This service calls the backend userInfo function to retrieve the current
 * user's roles and attributes, then uses that information to control UI
 * element visibility and enabled state.
 */
export class AuthorizationService {
  /**
   * Fetch user information from the backend
   *
   * Calls the CAP service's userInfo function to retrieve authenticated
   * user's roles and company code attributes.
   */
  private static async fetchUserInfo(): Promise<UserInfo> {
    if (userInfoCache) {
      return userInfoCache;
    }

    try {
      // Call the backend userInfo function
      const response = await fetch('/odata/v4/clients/userInfo()', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include authentication cookies
      });

      if (!response.ok) {
        Log.error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch user info: ${response.status}`);
      }

      const data = await response.json();
      const roles = Array.isArray(data.roles) ? data.roles : [];
      const attributes = data.attributes || {};

      // Build user info from response
      const isAdmin = roles.includes(UserRole.HRAdmin);
      const isEditor = roles.includes(UserRole.HREditor);
      const isViewer = roles.includes(UserRole.HRViewer);

      userInfoCache = {
        roles,
        attributes,
        isAdmin,
        isEditor,
        isViewer: isViewer && !isEditor && !isAdmin,
      };

      Log.info('AuthorizationService: User info loaded', {
        roles: userInfoCache.roles.join(', '),
        isAdmin: userInfoCache.isAdmin,
        isEditor: userInfoCache.isEditor,
        isViewer: userInfoCache.isViewer,
      });

      return userInfoCache;
    } catch (error) {
      Log.error(
        'AuthorizationService: Error fetching user info, defaulting to read-only - ' + String(error)
      );

      // Fall back to least-privileged (viewer-only) on error, but do not cache
      // the degraded state so that a subsequent successful call can restore the
      // correct roles once the backend recovers.
      return {
        roles: [UserRole.HRViewer],
        attributes: {},
        isAdmin: false,
        isViewer: true,
        isEditor: false,
      };
    }
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
