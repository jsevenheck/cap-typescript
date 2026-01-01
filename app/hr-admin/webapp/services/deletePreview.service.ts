/**
 * Service for previewing the impact of deleting entities.
 * Used to show informative confirmation dialogs before deletion.
 */

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
      `Failed to fetch delete preview: ${response.status} ${response.statusText}${errorDetails}`,
    );
  }

  const data = await response.json();
  return {
    clientName: data.clientName ?? '',
    employeeCount: data.employeeCount ?? 0,
    costCenterCount: data.costCenterCount ?? 0,
    locationCount: data.locationCount ?? 0,
    assignmentCount: data.assignmentCount ?? 0,
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
      `Failed to fetch delete preview: ${response.status} ${response.statusText}${errorDetails}`,
    );
  }

  const data = await response.json();
  return {
    costCenterName: data.costCenterName ?? '',
    costCenterCode: data.costCenterCode ?? '',
    employeeCount: data.employeeCount ?? 0,
    assignmentCount: data.assignmentCount ?? 0,
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
      `Failed to fetch delete preview: ${response.status} ${response.statusText}${errorDetails}`,
    );
  }

  const data = await response.json();
  return {
    locationCity: data.locationCity ?? '',
    locationStreet: data.locationStreet ?? '',
    employeeCount: data.employeeCount ?? 0,
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
