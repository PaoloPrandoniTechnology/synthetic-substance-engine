/** Sottoinsieme del contratto OpenAI effettivamente usato dal proxy. */

export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: "list";
  data: OpenAIModel[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content?: string | null;
  name?: string;
  [key: string]: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  logit_bias?: Record<string, number>;
  [key: string]: unknown;
}
