/**
 * Statistics service for fetching statistics from the backend.
 * Used by dashboard components to display aggregated data.
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
 * Generic statistics fetcher that handles common fetch logic.
 * @param functionName - The OData function name to call
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @param entityName - Name of the entity for error messages
 * @returns Promise resolving to the raw JSON response data
 */
async function fetchStatistics(functionName: string, clientId?: string, entityName: string = 'statistics'): Promise<Record<string, unknown>> {
  const encodedClientId = clientId ? encodeURIComponent(clientId) : null;
  const url = encodedClientId
    ? `/odata/v4/clients/${functionName}(clientId='${encodedClientId}')`
    : `/odata/v4/clients/${functionName}()`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${entityName}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetches employee statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to employee statistics
 */
export async function fetchEmployeeStatistics(clientId?: string): Promise<EmployeeStatistics> {
  const data = await fetchStatistics('employeeStatistics', clientId, 'employee statistics');
  return {
    totalEmployees: (data.totalEmployees as number) ?? 0,
    activeEmployees: (data.activeEmployees as number) ?? 0,
    inactiveEmployees: (data.inactiveEmployees as number) ?? 0,
    internalEmployees: (data.internalEmployees as number) ?? 0,
    externalEmployees: (data.externalEmployees as number) ?? 0,
    managersCount: (data.managersCount as number) ?? 0,
    recentHires: (data.recentHires as number) ?? 0,
    upcomingExits: (data.upcomingExits as number) ?? 0,
  };
}

/**
 * Fetches cost center statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to cost center statistics
 */
export async function fetchCostCenterStatistics(clientId?: string): Promise<CostCenterStatistics> {
  const data = await fetchStatistics('costCenterStatistics', clientId, 'cost center statistics');
  return {
    totalCostCenters: (data.totalCostCenters as number) ?? 0,
    activeCostCenters: (data.activeCostCenters as number) ?? 0,
    expiredCostCenters: (data.expiredCostCenters as number) ?? 0,
    upcomingExpiry: (data.upcomingExpiry as number) ?? 0,
    withAssignedEmployees: (data.withAssignedEmployees as number) ?? 0,
  };
}

/**
 * Fetches location statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to location statistics
 */
export async function fetchLocationStatistics(clientId?: string): Promise<LocationStatistics> {
  const data = await fetchStatistics('locationStatistics', clientId, 'location statistics');
  return {
    totalLocations: (data.totalLocations as number) ?? 0,
    activeLocations: (data.activeLocations as number) ?? 0,
    expiredLocations: (data.expiredLocations as number) ?? 0,
    upcomingExpiry: (data.upcomingExpiry as number) ?? 0,
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
