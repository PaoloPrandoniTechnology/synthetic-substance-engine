import type { FastifyInstance } from "fastify";
import type { SubstanceRegistry } from "../../engine/registry.js";
import type { SessionStore } from "../../engine/session.js";
import { AppError } from "../../shared/errors.js";
import { buildTripReport } from "../../telemetry/trip-report.js";

export interface ReportRouteDeps {
  registry: SubstanceRegistry;
  sessions: SessionStore;
}

function readNumber(
  value: string | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(`Parametro ${field} non valido: usare un numero tra ${min} e ${max}`, {
      statusCode: 400,
      type: "invalid_request_error",
      code: "invalid_parameter",
      param: field,
    });
  }

  return parsed;
}

export function registerReportRoutes(app: FastifyInstance, deps: ReportRouteDeps): void {
  /** Referto simulato: nessuna sessione, libera esplorazione di dose e tempo. */
  app.get("/v1/substances/:id/trip-report", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { dose?: string; elapsed?: string };
    const substance = deps.registry.get(id);

    if (!substance) {
      throw new AppError(`Sostanza sconosciuta: ${id}`, {
        statusCode: 404,
        type: "invalid_request_error",
        code: "substance_not_found",
        param: "id",
      });
    }

    const dose = readNumber(query.dose, "dose", 1, 0, 1);
    const elapsed = readNumber(query.elapsed, "elapsed", 0, 0, 86_400);

    return buildTripReport(substance, dose, elapsed);
  });

  /** Referto della sessione reale: usa il timer interno e conta le richieste fatte. */
  app.get("/v1/sessions/:sessionId/trip-report", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const snapshot = deps.sessions.snapshot(sessionId);
    const elapsed = deps.sessions.elapsedFor(sessionId);

    if (!snapshot || elapsed === undefined) {
      throw new AppError(`Sessione sconosciuta: ${sessionId}`, {
        statusCode: 404,
        type: "invalid_request_error",
        code: "session_not_found",
        param: "sessionId",
      });
    }

    const substance = deps.registry.get(snapshot.substanceId);

    if (!substance) {
      throw new AppError(`Sostanza sconosciuta: ${snapshot.substanceId}`, {
        statusCode: 404,
        type: "invalid_request_error",
        code: "substance_not_found",
        param: "sessionId",
      });
    }

    return {
      sessionId,
      requests: snapshot.uses,
      ...buildTripReport(substance, snapshot.dose, elapsed),
    };
  });
}
