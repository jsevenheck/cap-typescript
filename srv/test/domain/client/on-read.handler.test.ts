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
        return ['ACME', 'GLOBEX'];
      }
      return [];
    });

    await onRead(mockRequest);

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
        return ['ACME'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle company codes from CompanyCode attribute', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode') {
        return ['ACME'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle company codes from companyCodes attribute', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'companyCodes') {
        return ['ACME', 'GLOBEX'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME', 'GLOBEX'] } });
  });

  it('should merge company codes from both attributes', async () => {
    (mockRequest.user as any).is = jest.fn(() => false);
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode') {
        return ['ACME'];
      }
      if (name === 'companyCodes') {
        return ['GLOBEX', 'INITECH'];
      }
      return [];
    });

    await onRead(mockRequest);

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
        return ['ACME'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });

  it('should handle HREditor role with company restriction', async () => {
    (mockRequest.user as any).is = jest.fn((role: string) => role === 'HREditor');
    (mockRequest.user as any).attr = jest.fn((name: string) => {
      if (name === 'CompanyCode' || name === 'companyCodes') {
        return ['ACME'];
      }
      return [];
    });

    await onRead(mockRequest);

    expect(mockQuery.where).toHaveBeenCalledWith({ companyId: { in: ['ACME'] } });
  });
});
