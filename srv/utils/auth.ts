/**
 * Helpers for building and querying CAP user contexts.
 */
export interface UserAttributes {
  [name: string]: string[];
}

export interface UserContext {
  roles: Set<string>;
  attributes: UserAttributes;
}

export interface CapUserLike {
  is?: (role: string) => boolean;
  attr?: ((name: string) => unknown) | Record<string, unknown>;
}

const normalizeAttributeValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

export const buildUserContext = (user: CapUserLike | undefined): UserContext => {
  const roles = new Set<string>();
  const attributes: UserAttributes = {};

  if (!user) {
    return { roles, attributes };
  }

  const possibleRoles = ['HRAdmin', 'HRViewer', 'HREditor'];
  for (const role of possibleRoles) {
    if (user.is?.(role)) {
      roles.add(role);
    }
  }

  const attributeSource = user.attr;
  if (typeof attributeSource === 'function') {
    for (const name of ['CompanyCode', 'companyCodes']) {
      const values = normalizeAttributeValues(attributeSource.call(user, name));
      if (values.length > 0) {
        attributes[name] = values;
      }
    }
  } else if (attributeSource && typeof attributeSource === 'object') {
    for (const name of Object.keys(attributeSource)) {
      const values = normalizeAttributeValues((attributeSource as Record<string, unknown>)[name]);
      if (values.length > 0) {
        attributes[name] = values;
      }
    }
  }

  return { roles, attributes };
};

export const userHasRole = (user: UserContext, role: string): boolean => user.roles.has(role);

export const getAttributeValues = (user: UserContext, name: string): string[] => user.attributes[name] ?? [];

export const collectAttributeValues = (user: UserContext, names: string[]): string[] => {
  const collected = new Set<string>();
  for (const name of names) {
    for (const value of getAttributeValues(user, name)) {
      if (value) {
        collected.add(value.trim());
      }
    }
  }
  return Array.from(collected);
};
