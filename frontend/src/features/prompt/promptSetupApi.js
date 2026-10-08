import { apiFetch, jsonBody } from "../../api/client";

/** Phase 1 · Prompt — calls the prompt-setup agents on the backend. */
const base = "/api/prompt-setup";

export const promptSetupApi = {
  engines: () => apiFetch(`${base}/engines`),
  agentInfo: () => apiFetch(`${base}/agents`),
  startRun: (body) => apiFetch(`${base}/runs`, jsonBody(body)),
  generateIntents: (runId) => apiFetch(`${base}/runs/${runId}/intents`, jsonBody({})),
  saveIntents: (runId, updates, reviewer) => apiFetch(`${base}/runs/${runId}/intents`, jsonBody({ updates, reviewer }, "PATCH")),
  generatePrompts: (runId, body) => apiFetch(`${base}/runs/${runId}/prompts`, jsonBody(body)),
  savePrompts: (runId, updates, reviewer) => apiFetch(`${base}/runs/${runId}/prompts`, jsonBody({ updates, reviewer }, "PATCH")),
  regeneratePrompt: (runId, body) => apiFetch(`${base}/runs/${runId}/prompts/regenerate`, jsonBody(body)),
  prepareSheet: (runId, body) => apiFetch(`${base}/runs/${runId}/sheet`, jsonBody(body)),
  complete: (runId, body) => apiFetch(`${base}/runs/${runId}/complete`, jsonBody(body)),
};
