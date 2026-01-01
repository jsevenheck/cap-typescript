/**
 * Service for previewing the impact of deleting entities.
 * Used to show informative confirmation dialogs before deletion.
 */

/**
 * Fetch JSON data from an OData function endpoint.
 * Handles HTTP error responses by extracting error details from the response body.
 * @param url - The URL to fetch
 * @param errorContext - Context string for error messages (e.g., "delete preview")
 * @returns Promise resolving to parsed JSON data
 */
async function fetchODataFunction<T>(url: string, errorContext: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    let errorDetails = '';

    try {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const errorBody = await response.json();
        const bodyMessage =
          (errorBody && (errorBody.error?.message || errorBody.message)) || undefined;

        if (bodyMessage) {
          errorDetails = ` - ${bodyMessage}`;
        } else {
          errorDetails = ` - ${JSON.stringify(errorBody)}`;
        }
      } else {
        const text = await response.text();
        if (text) {
          errorDetails = ` - ${text}`;
        }
      }
    } catch {
      // Ignore errors while reading/processing the error response body.
    }

    throw new Error(
      `Failed to fetch ${errorContext}: ${response.status} ${response.statusText}${errorDetails}`,
    );
  }

  return response.json() as Promise<T>;
}

export interface ClientDeletePreview {
  clientName: string;
  employeeCount: number;
  costCenterCount: number;
  locationCount: number;
  assignmentCount: number;
}

/**
 * Fetches a preview of what will be deleted when a client is removed.
 * @param clientId - The client ID to preview deletion for
 * @returns Promise resolving to delete preview data
 */
export async function fetchClientDeletePreview(clientId: string): Promise<ClientDeletePreview> {
  const encodedClientId = encodeURIComponent(clientId);
  const url = `/odata/v4/clients/clientDeletePreview(clientId='${encodedClientId}')`;

  const data = await fetchODataFunction<Record<string, unknown>>(url, 'delete preview');
  return {
    clientName: (data.clientName as string) ?? '',
    employeeCount: (data.employeeCount as number) ?? 0,
    costCenterCount: (data.costCenterCount as number) ?? 0,
    locationCount: (data.locationCount as number) ?? 0,
    assignmentCount: (data.assignmentCount as number) ?? 0,
  };
}

/**
 * Build a human-readable summary of entities that will be deleted
 */
export function buildDeleteSummary(preview: ClientDeletePreview): string {
  const parts: string[] = [];

  if (preview.employeeCount > 0) {
    parts.push(`${preview.employeeCount} employee${preview.employeeCount === 1 ? '' : 's'}`);
  }
  if (preview.costCenterCount > 0) {
    parts.push(`${preview.costCenterCount} cost center${preview.costCenterCount === 1 ? '' : 's'}`);
  }
  if (preview.locationCount > 0) {
    parts.push(`${preview.locationCount} location${preview.locationCount === 1 ? '' : 's'}`);
  }
  if (preview.assignmentCount > 0) {
    parts.push(`${preview.assignmentCount} assignment${preview.assignmentCount === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join(', ');
}

export interface CostCenterDeletePreview {
  costCenterName: string;
  costCenterCode: string;
  employeeCount: number;
  assignmentCount: number;
}

/**
 * Fetches a preview of what will be affected when a cost center is removed.
 * @param costCenterId - The cost center ID to preview deletion for
 * @returns Promise resolving to delete preview data
 */
export async function fetchCostCenterDeletePreview(costCenterId: string): Promise<CostCenterDeletePreview> {
  const encodedCostCenterId = encodeURIComponent(costCenterId);
  const url = `/odata/v4/clients/costCenterDeletePreview(costCenterId='${encodedCostCenterId}')`;

  const data = await fetchODataFunction<Record<string, unknown>>(url, 'cost center delete preview');
  return {
    costCenterName: (data.costCenterName as string) ?? '',
    costCenterCode: (data.costCenterCode as string) ?? '',
    employeeCount: (data.employeeCount as number) ?? 0,
    assignmentCount: (data.assignmentCount as number) ?? 0,
  };
}

/**
 * Build a human-readable summary of entities that will be affected by cost center deletion
 */
export function buildCostCenterDeleteSummary(preview: CostCenterDeletePreview): string {
  const parts: string[] = [];

  if (preview.employeeCount > 0) {
    parts.push(`${preview.employeeCount} employee${preview.employeeCount === 1 ? '' : 's'} assigned`);
  }
  if (preview.assignmentCount > 0) {
    parts.push(`${preview.assignmentCount} assignment record${preview.assignmentCount === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join(', ');
}

export interface LocationDeletePreview {
  locationCity: string;
  locationStreet: string;
  employeeCount: number;
}

/**
 * Fetches a preview of what will be affected when a location is removed.
 * @param locationId - The location ID to preview deletion for
 * @returns Promise resolving to delete preview data
 */
export async function fetchLocationDeletePreview(locationId: string): Promise<LocationDeletePreview> {
  const encodedLocationId = encodeURIComponent(locationId);
  const url = `/odata/v4/clients/locationDeletePreview(locationId='${encodedLocationId}')`;

  const data = await fetchODataFunction<Record<string, unknown>>(url, 'location delete preview');
  return {
    locationCity: (data.locationCity as string) ?? '',
    locationStreet: (data.locationStreet as string) ?? '',
    employeeCount: (data.employeeCount as number) ?? 0,
  };
}

/**
 * Build a human-readable summary of entities that will be affected by location deletion
 */
export function buildLocationDeleteSummary(preview: LocationDeletePreview): string {
  if (preview.employeeCount > 0) {
    return `${preview.employeeCount} employee${preview.employeeCount === 1 ? '' : 's'} assigned`;
  }

  return '';
}
