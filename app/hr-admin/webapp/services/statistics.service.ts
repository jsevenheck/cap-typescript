/**
 * Statistics service for fetching employee statistics from the backend.
 * Used by dashboard components to display aggregated employee data.
 */

export interface EmployeeStatistics {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  internalEmployees: number;
  externalEmployees: number;
  managersCount: number;
  recentHires: number;
  upcomingExits: number;
}

export interface CostCenterStatistics {
  totalCostCenters: number;
  activeCostCenters: number;
  expiredCostCenters: number;
  upcomingExpiry: number;
  withAssignedEmployees: number;
}

export interface LocationStatistics {
  totalLocations: number;
  activeLocations: number;
  expiredLocations: number;
  upcomingExpiry: number;
}

/**
 * Fetches employee statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to employee statistics
 */
export async function fetchEmployeeStatistics(clientId?: string): Promise<EmployeeStatistics> {
  // Properly encode the clientId to prevent URL injection
  const encodedClientId = clientId ? encodeURIComponent(clientId) : null;
  const url = encodedClientId
    ? `/odata/v4/clients/employeeStatistics(clientId='${encodedClientId}')`
    : '/odata/v4/clients/employeeStatistics()';

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch statistics: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    totalEmployees: data.totalEmployees ?? 0,
    activeEmployees: data.activeEmployees ?? 0,
    inactiveEmployees: data.inactiveEmployees ?? 0,
    internalEmployees: data.internalEmployees ?? 0,
    externalEmployees: data.externalEmployees ?? 0,
    managersCount: data.managersCount ?? 0,
    recentHires: data.recentHires ?? 0,
    upcomingExits: data.upcomingExits ?? 0,
  };
}

/**
 * Fetches cost center statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to cost center statistics
 */
export async function fetchCostCenterStatistics(clientId?: string): Promise<CostCenterStatistics> {
  const encodedClientId = clientId ? encodeURIComponent(clientId) : null;
  const url = encodedClientId
    ? `/odata/v4/clients/costCenterStatistics(clientId='${encodedClientId}')`
    : '/odata/v4/clients/costCenterStatistics()';

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch cost center statistics: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    totalCostCenters: data.totalCostCenters ?? 0,
    activeCostCenters: data.activeCostCenters ?? 0,
    expiredCostCenters: data.expiredCostCenters ?? 0,
    upcomingExpiry: data.upcomingExpiry ?? 0,
    withAssignedEmployees: data.withAssignedEmployees ?? 0,
  };
}

/**
 * Fetches location statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to location statistics
 */
export async function fetchLocationStatistics(clientId?: string): Promise<LocationStatistics> {
  const encodedClientId = clientId ? encodeURIComponent(clientId) : null;
  const url = encodedClientId
    ? `/odata/v4/clients/locationStatistics(clientId='${encodedClientId}')`
    : '/odata/v4/clients/locationStatistics()';

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch location statistics: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    totalLocations: data.totalLocations ?? 0,
    activeLocations: data.activeLocations ?? 0,
    expiredLocations: data.expiredLocations ?? 0,
    upcomingExpiry: data.upcomingExpiry ?? 0,
  };
}

/**
 * Default/empty statistics for initial state
 */
export function getEmptyStatistics(): EmployeeStatistics {
  return {
    totalEmployees: 0,
    activeEmployees: 0,
    inactiveEmployees: 0,
    internalEmployees: 0,
    externalEmployees: 0,
    managersCount: 0,
    recentHires: 0,
    upcomingExits: 0,
  };
}

/**
 * Default/empty cost center statistics for initial state
 */
export function getEmptyCostCenterStatistics(): CostCenterStatistics {
  return {
    totalCostCenters: 0,
    activeCostCenters: 0,
    expiredCostCenters: 0,
    upcomingExpiry: 0,
    withAssignedEmployees: 0,
  };
}

/**
 * Default/empty location statistics for initial state
 */
export function getEmptyLocationStatistics(): LocationStatistics {
  return {
    totalLocations: 0,
    activeLocations: 0,
    expiredLocations: 0,
    upcomingExpiry: 0,
  };
}
