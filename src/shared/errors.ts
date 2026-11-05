/** Errore applicativo con status HTTP e codice in stile OpenAI. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly code: string;
  readonly param: string | null;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      type?: string;
      code?: string;
      param?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode ?? 500;
    this.type = options.type ?? "server_error";
    this.code = options.code ?? "internal_error";
    this.param = options.param ?? null;
  }
}

/** Corpo di errore identico a quello delle API OpenAI. */
export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string;
  };
}

export function toOpenAIErrorBody(error: AppError): OpenAIErrorBody {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
    },
  };
}
