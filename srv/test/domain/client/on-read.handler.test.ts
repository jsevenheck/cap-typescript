import type { Request } from '@sap/cds';
import { onRead } from '../../../domain/client/handlers/on-read';

interface RequestWithUser extends Request {
  user?: any;
  query?: any;
}

describe('Client READ Handler', () => {
  let mockRequest: RequestWithUser;
  let mockQuery: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = {
      where: jest.fn(),
    };

    mockRequest = {
      user: {
        is: jest.fn(),
        attr: jest.fn(),
      },
      query: mockQuery,
    } as RequestWithUser;
  });

  it('should allow HRAdmin to read all clients', async () => {
    (mockRequest.user as any).is = jest.fn((role: string) => role === 'HRAdmin');

    await onRead(mockRequest);

    expect(mockQuery.where).not.toHaveBeenCalled();
  });

  it('should filter clients by user company codes', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['acme', 'globex'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Codes are normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME', 'GLOBEX'] } });
  });

  it('should restrict to no results when user has no company codes', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn().mockReturnValue([]);

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: null });
  });

  it('should handle single company code', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['acme'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Code is normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle company codes from CompanyCode attribute', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode') {
        return ['acme'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Code is normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle company codes from companyCodes attribute', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'companyCodes') {
        return ['acme', 'globex'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Codes are normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME', 'GLOBEX'] } });
  });

  it('should merge company codes from both attributes', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode') {
        return ['acme'];
      }
      if (name === 'companyCodes') {
        return ['globex', 'initech'];
      }
      return [];
    });

    await onRead(mockRequest);

    // All codes are normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: expect.objectContaining({
          in: expect.arrayContaining(['ACME', 'GLOBEX', 'INITECH']),
        }),
      }),
    );
  });

  it('should handle HRViewer role with company restriction', async () => {
    (mockRequest.user as any).is = jest.fn((role: string) => role === 'HRViewer');
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['acme'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Code is normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle HREditor role with company restriction', async () => {
    (mockRequest.user as any).is = jest.fn((role: string) => role === 'HREditor');
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['acme'];
      }
      return [];
    });

    await onRead(mockRequest);

    // Code is normalized to uppercase
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should normalize lowercase company codes to uppercase', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['comp-001', 'comp-002'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['COMP-001', 'COMP-002'] } });
  });

  it('should normalize mixed-case company codes to uppercase', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['Comp-001', 'COMP-002', 'comp-003'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['COMP-001', 'COMP-002', 'COMP-003'] } });
  });

  it('should handle whitespace-padded company codes from IAS', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode') {
        return [' comp-001 ', ' comp-002'];
      }
      return [];
    });

    await onRead(mockRequest);

    // collectAttributeValues already trims, so we should get normalized uppercase codes
    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['COMP-001', 'COMP-002'] } });
  });
});
