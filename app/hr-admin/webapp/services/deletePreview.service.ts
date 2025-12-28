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
