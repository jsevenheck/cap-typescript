import type { NextFunction, Request, Response } from 'express';

const INVALID_API_KEY_RESPONSE = { error: 'invalid_api_key' } as const;

function extractApiKey(req: Request): string | undefined {
  const headerKey = req.header('x-api-key');
  if (headerKey) {
    return headerKey.trim();
  }

  const authorization = req.header('authorization');
  if (!authorization) {
    return undefined;
  }

  const matches = authorization.match(/^ApiKey\s+(?<key>.+)$/i);
  return matches?.groups?.key?.trim();
}

export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const configuredKey = process.env.EMPLOYEE_EXPORT_API_KEY?.trim();
  const providedKey = extractApiKey(req);

  if (!configuredKey || !providedKey || configuredKey !== providedKey) {
    res.status(401).json(INVALID_API_KEY_RESPONSE);
    return;
  }

  next();
};

export default apiKeyMiddleware;
