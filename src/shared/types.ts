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
