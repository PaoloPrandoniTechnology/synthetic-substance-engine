import type { ChatCompletionRequest } from "../shared/types.js";
import type { ChatProviderClient, ForwardOptions } from "./base.js";
import type { Provider } from "./config.js";

/**
 * URL dell'endpoint chat: i provider `openai`/`openai-compatible` espongono
 * `/chat/completions` sotto la base, Ollama sotto `/v1`.
 */
export function chatCompletionsUrl(provider: Provider): string {
  const base = provider.baseUrl.replace(/\/+$/, "");
  return provider.kind === "ollama" ? `${base}/v1/chat/completions` : `${base}/chat/completions`;
}

export function createOpenAICompatibleClient(provider: Provider): ChatProviderClient {
  const url = chatCompletionsUrl(provider);

  return {
    provider,
    chatCompletionsUrl: () => url,

    async forward(body: ChatCompletionRequest, options: ForwardOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: body.stream ? "text/event-stream" : "application/json",
      };

      if (provider.apiKeyEnv) {
        const apiKey = options.env?.[provider.apiKeyEnv];
        if (!apiKey) {
          throw new Error(
            `Variabile d'ambiente ${provider.apiKeyEnv} mancante per il provider "${provider.id}"`,
          );
        }
        headers.authorization = `Bearer ${apiKey}`;
      }

      return fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    },
  };
}
