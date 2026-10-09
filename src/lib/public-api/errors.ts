// Errors thrown by /api/v1 handlers (client-safe, no server deps).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new ApiError(400, 'invalid_request', message, details)
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`)
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(422, code, message, details)
