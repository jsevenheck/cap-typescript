import { getODataService } from "../../services/odata";

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
 */
export class AuthorizationService {
  /**
   * Fetch user information from the backend
   */
  private static async fetchUserInfo(): Promise<UserInfo> {
    if (userInfoCache) {
      return userInfoCache;
    }

    try {
      const odataService = getODataService();
      const model = odataService.getModel();

      // Get user context from OData model security settings
      // In CAP, user info is typically available through the model's SecurityToken
      const securityData = (model as any).getSecurityToken?.() || null;

      // For mocked auth, we can parse from headers or metadata
      // In production with IAS, this comes from the JWT token

      // Default to viewer-only permissions if we can't determine
      const roles: string[] = [];
      const attributes: Record<string, string[]> = {};

      // Try to get user info from a custom function import or metadata
      // Note: In a real implementation, you might call a custom action or
      // parse the user context from the OData metadata

      // For now, assume we can access some user endpoint or parse from headers
      // This would typically be configured based on your CAP service setup

      userInfoCache = {
        roles,
        attributes,
        isAdmin: roles.includes(UserRole.HRAdmin),
        isViewer: roles.includes(UserRole.HRViewer),
        isEditor: roles.includes(UserRole.HREditor),
      };

      return userInfoCache;
    } catch (error) {
      console.error("Failed to fetch user info:", error);
      // Return minimal permissions on error
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
