import type { ApiError, ApiErrorCode } from '@plate/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

/** Error type for expected failures; the handler maps it straight to a JSON response. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send(errorBody(error.code, error.message, error.details));
    return;
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((v) => ({
      path: v.instancePath.replace(/^\//, '').replace(/\//g, '.'),
      message: v.message,
    }));
    void reply
      .status(400)
      .send(errorBody('VALIDATION_ERROR', 'Request validation failed', details));
    return;
  }

  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'response failed schema validation');
    void reply.status(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
    return;
  }

  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;

  if (statusCode === 429) {
    void reply.status(429).send(errorBody('RATE_LIMITED', 'Too many requests. Try again later.'));
    return;
  }

  if (statusCode >= 400 && statusCode < 500) {
    // Fastify-generated client errors (bad JSON, payload too large, unsupported media type, ...).
    void reply.status(statusCode).send(errorBody('VALIDATION_ERROR', error.message));
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  void reply.status(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
}
