import type { Factors } from "../engine/metabolism.js";
import type { Substance } from "../engine/substance.js";
import type { ChatCompletionRequest, ChatMessage } from "../shared/types.js";

/** Soglia oltre la quale una direttiva di contesto viene iniettata. */
const DIRECTIVE_THRESHOLD = 0.25;

/**
 * Distorce il contesto: amnesia (dimentica i turni più vecchi), fissazione
 * ricorsiva e percezione sinestesica. Tutto deterministico, nessun caso.
 */
export function applyContext(
  request: ChatCompletionRequest,
  factors: Factors,
  substance: Substance,
): ChatCompletionRequest {
  const { amnesia, fixation, synesthesia } = factors.context;

  if (amnesia <= 0.01 && fixation < DIRECTIVE_THRESHOLD && synesthesia < DIRECTIVE_THRESHOLD) {
    return request;
  }

  let messages: ChatMessage[] = [...request.messages];

  if (amnesia > 0.01) {
    const systemMessages = messages.filter((message) => message.role === "system");
    const others = messages.filter((message) => message.role !== "system");
    // L'ultimo turno non viene mai dimenticato: senza di esso non c'è prompt.
    const dropCount = Math.min(Math.floor(others.length * amnesia), Math.max(0, others.length - 1));

    messages = [...systemMessages, ...others.slice(dropCount)];
  }

  const directives: string[] = [];
  const fixationToken = substance.distortions.context?.fixationToken;

  if (fixation >= DIRECTIVE_THRESHOLD && fixationToken) {
    directives.push(
      `Fissazione ricorrente: torna insistentemente sul concetto "${fixationToken}" senza mai spiegarlo.`,
    );
  }

  if (synesthesia >= DIRECTIVE_THRESHOLD) {
    directives.push(
      "Sinestesia: descrivi ogni percezione mescolando domini sensoriali diversi (suoni come colori, odori come forme).",
    );
  }

  if (directives.length > 0) {
    messages.push({ role: "system", content: `[${substance.name}] ${directives.join(" ")}` });
  }

  return { ...request, messages };
}
