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

/**
 * Fetches employee statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to employee statistics
 */
export async function fetchEmployeeStatistics(clientId?: string): Promise<EmployeeStatistics> {
  const url = clientId
    ? `/odata/v4/clients/employeeStatistics(clientId=${clientId})`
    : '/odata/v4/clients/employeeStatistics(clientId=null)';

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
