import type { FastifyError, FastifyInstance } from "fastify";
import { AppError, toOpenAIErrorBody } from "../../shared/errors.js";

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const fastifyError = error as FastifyError;
  const message = fastifyError.message || "Errore interno del proxy";
  const statusCode = fastifyError.statusCode ?? 500;

  if (statusCode === 400) {
    return new AppError(message, {
      statusCode,
      type: "invalid_request_error",
      code: "bad_request",
    });
  }

  if (statusCode === 404) {
    return new AppError(message, {
      statusCode,
      type: "invalid_request_error",
      code: "not_found",
    });
  }

  return new AppError(message, {
    statusCode,
    type: "server_error",
    code: "internal_error",
  });
}

/** Registra l'error handler: il client non deve accorgersi del proxy, nemmeno in errore. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const error = new AppError(`Rotta non trovata: ${request.method} ${request.url}`, {
      statusCode: 404,
      type: "invalid_request_error",
      code: "not_found",
    });
    void reply.status(error.statusCode).send(toOpenAIErrorBody(error));
  });

  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error);

    if (appError.statusCode >= 500) {
      request.log.error({ err: error }, "errore non gestito");
    } else {
      request.log.warn({ err: error }, "richiesta rifiutata");
    }

    void reply.status(appError.statusCode).send(toOpenAIErrorBody(appError));
  });
}
