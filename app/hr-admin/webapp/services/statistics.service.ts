import Core from "sap/ui/core/Core";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";

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

type ODataErrorResponse = {
  message?: string;
  statusText?: string;
  responseText?: string;
  error?: {
    message?: string;
  };
};

function extractErrorMessage(error: unknown, fallback: string): string {
  // Handle native Error instances first
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const odataError = error as ODataErrorResponse;

    if (odataError.error?.message) {
      return odataError.error.message;
    }

    if (odataError.message) {
      return odataError.message;
    }

    if (typeof odataError.responseText === "string" && odataError.responseText) {
      try {
        const parsed = JSON.parse(odataError.responseText) as { error?: { message?: string } };
        if (parsed.error?.message) {
          return parsed.error.message;
        }
      } catch {
        return fallback;
      }
    }

    if (odataError.statusText) {
      return odataError.statusText;
    }
  }

  return fallback;
}

function buildODataErrorMessage(error: unknown, entityName: string): string {
  const fallback = "Unexpected error";
  const message = extractErrorMessage(error, fallback);
  return `Failed to fetch ${entityName}: ${message}`;
}

function resolveStatisticsPayload(data: Record<string, unknown>): Record<string, unknown> {
  if ("value" in data) {
    const value = (data as { value?: unknown }).value;
    if (isPlainObject(value)) {
      return value;
    }

    throw new Error(
      "Invalid statistics payload: 'value' must be a plain object when present."
    );
  }
  return data;
}

function getDefaultODataModel(): ODataModel {
  const model = Core.getModel();
  if (!model) {
    throw new Error(
      "Default OData model not found. Ensure the application has been initialized properly and a default OData model is set on sap.ui.core.Core."
    );
  }
  if (!(model instanceof ODataModel)) {
    throw new Error("Default model is not an OData V4 ODataModel");
  }
  return model;
}

/**
 * Type guard to validate that a value is a plain object (not null, not an array, not a class instance).
 * @param value - The value to check
 * @returns true if the value is a plain object, false otherwise
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Generic statistics fetcher that handles common fetch logic.
 * @param functionName - The OData function name to call
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @param entityName - Name of the entity for error messages
 * @returns Promise resolving to the raw JSON response data
 */
async function fetchStatistics(
  functionName: string,
  clientId?: string,
  entityName: string = "statistics"
): Promise<Record<string, unknown>> {
  const model = getDefaultODataModel();
  const functionContext = model.bindContext(`/${functionName}(...)`);
  if (clientId) {
    functionContext.setParameter("clientId", clientId);
  }

  try {
    const result = await functionContext.requestObject();

    // Validate that we received a plain object
    if (!isPlainObject(result)) {
      throw new Error(
        `Invalid response from ${entityName}: Expected a plain object, but received ${typeof result}`
      );
    }
    return result;
  } catch (error: unknown) {
    if (error instanceof Error) {
      const enhancedError = new Error(buildODataErrorMessage(error, entityName), {
        cause: error,
      });
      throw enhancedError;
    }
    throw new Error(buildODataErrorMessage(error, entityName), { cause: error });
  }
}

/**
 * Fetches employee statistics from the backend.
 * @param clientId - Optional client ID to filter statistics for a specific client
 * @returns Promise resolving to employee statistics
 */
export async function fetchEmployeeStatistics(clientId?: string): Promise<EmployeeStatistics> {
  const data = resolveStatisticsPayload(
    await fetchStatistics("employeeStatistics", clientId, "employee statistics")
  );
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
  const data = resolveStatisticsPayload(
    await fetchStatistics("costCenterStatistics", clientId, "cost center statistics")
  );
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
  const data = resolveStatisticsPayload(
    await fetchStatistics("locationStatistics", clientId, "location statistics")
  );
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
