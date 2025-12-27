/**
 * Unit tests for delete-preview.service
 */
import { getClientDeletePreview, ClientDeletePreview } from '../../../domain/client/services/delete-preview.service';

describe('getClientDeletePreview', () => {
  // Mock transaction object
  const createMockTransaction = (results: Record<string, unknown>) => ({
    run: jest.fn().mockImplementation((query) => {
      // Parse the query to determine which result to return
      const queryString = JSON.stringify(query);

      if (queryString.includes('clientmgmt.Clients')) {
        return Promise.resolve(results.client);
      }
      if (queryString.includes('clientmgmt.Employees')) {
        return Promise.resolve(results.employees);
      }
      if (queryString.includes('clientmgmt.CostCenters')) {
        return Promise.resolve(results.costCenters);
      }
      if (queryString.includes('clientmgmt.Locations')) {
        return Promise.resolve(results.locations);
      }
      if (queryString.includes('clientmgmt.EmployeeCostCenterAssignments')) {
        return Promise.resolve(results.assignments);
      }
      return Promise.resolve(null);
    }),
  });

  it('returns null when client does not exist', async () => {
    const mockTx = createMockTransaction({
      client: null,
      employees: [{ count: 0 }],
      costCenters: [{ count: 0 }],
      locations: [{ count: 0 }],
      assignments: [{ count: 0 }],
    });

    const result = await getClientDeletePreview(mockTx as any, 'non-existent-id');

    expect(result).toBeNull();
  });

  it('returns correct counts when client exists with no children', async () => {
    const mockTx = createMockTransaction({
      client: { name: 'Test Client' },
      employees: [{ count: 0 }],
      costCenters: [{ count: 0 }],
      locations: [{ count: 0 }],
      assignments: [{ count: 0 }],
    });

    const result = await getClientDeletePreview(mockTx as any, 'test-client-id');

    expect(result).not.toBeNull();
    expect(result?.clientName).toBe('Test Client');
    expect(result?.employeeCount).toBe(0);
    expect(result?.costCenterCount).toBe(0);
    expect(result?.locationCount).toBe(0);
    expect(result?.assignmentCount).toBe(0);
  });

  it('returns correct counts when client exists with children', async () => {
    const mockTx = createMockTransaction({
      client: { name: 'Test Client' },
      employees: [{ count: 5 }],
      costCenters: [{ count: 3 }],
      locations: [{ count: 2 }],
      assignments: [{ count: 10 }],
    });

    const result = await getClientDeletePreview(mockTx as any, 'test-client-id');

    expect(result).not.toBeNull();
    expect(result?.clientName).toBe('Test Client');
    expect(result?.employeeCount).toBe(5);
    expect(result?.costCenterCount).toBe(3);
    expect(result?.locationCount).toBe(2);
    expect(result?.assignmentCount).toBe(10);
  });

  it('handles string count values correctly', async () => {
    const mockTx = createMockTransaction({
      client: { name: 'Test Client' },
      employees: [{ count: '5' }],
      costCenters: [{ count: '3' }],
      locations: [{ count: '2' }],
      assignments: [{ count: '10' }],
    });

    const result = await getClientDeletePreview(mockTx as any, 'test-client-id');

    expect(result).not.toBeNull();
    expect(result?.employeeCount).toBe(5);
    expect(result?.costCenterCount).toBe(3);
    expect(result?.locationCount).toBe(2);
    expect(result?.assignmentCount).toBe(10);
  });

  it('handles missing name property', async () => {
    const mockTx = createMockTransaction({
      client: {},
      employees: [{ count: 0 }],
      costCenters: [{ count: 0 }],
      locations: [{ count: 0 }],
      assignments: [{ count: 0 }],
    });

    const result = await getClientDeletePreview(mockTx as any, 'test-client-id');

    expect(result).not.toBeNull();
    expect(result?.clientName).toBe('');
  });
});
