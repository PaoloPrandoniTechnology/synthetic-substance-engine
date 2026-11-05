import type { ChatCompletionRequest } from "../shared/types.js";
import type { Provider } from "./config.js";

export interface ForwardOptions {
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

export interface ChatProviderClient {
  readonly provider: Provider;
  chatCompletionsUrl(): string;
  forward(body: ChatCompletionRequest, options?: ForwardOptions): Promise<Response>;
}
