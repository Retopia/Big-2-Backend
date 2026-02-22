export const rooms = new Map(); // roomName -> Room instance
export const usernameToPlayer = new Map(); // username -> Player instance
export const announcementState = { current: null };

const DEFAULT_LLM_MODEL = process.env.OPENROUTER_MODEL || "x-ai/grok-4-fast";
let activeLLMModel = DEFAULT_LLM_MODEL;

export function cleanupEmptyRooms() {
  for (const [name, room] of rooms.entries()) {
    if (room.isEmpty()) rooms.delete(name);
  }
}

export function getActiveLLMModel() {
  return activeLLMModel;
}

export function setActiveLLMModel(model) {
  activeLLMModel = model;
  return activeLLMModel;
}

export function getDefaultLLMModel() {
  return DEFAULT_LLM_MODEL;
}
