"use strict";

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStates(rawStates) {
  const parsed = typeof rawStates === "string"
    ? JSON.parse(rawStates || "[]")
    : rawStates;

  if (!Array.isArray(parsed)) {
    throw new Error("Allowed states must be an array of strings.");
  }

  const seen = new Set();

  return parsed.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error("Each allowed state must be a string.");
    }

    const trimmed = entry.trim();

    if (!trimmed) {
      throw new Error("State names must not be empty.");
    }

    if (seen.has(trimmed)) {
      throw new Error(`Duplicate state name: ${trimmed}`);
    }

    seen.add(trimmed);
    return trimmed;
  });
}

function parseInitialContext(rawContext) {
  if (rawContext === undefined || rawContext === null || rawContext === "") {
    return {};
  }

  const parsed = typeof rawContext === "string"
    ? JSON.parse(rawContext)
    : rawContext;

  if (!isPlainObject(parsed)) {
    throw new Error("Initial context must be a JSON object.");
  }

  return cloneValue(parsed);
}

function shallowMergeContext(currentContext, contextUpdate) {
  return Object.assign({}, currentContext, contextUpdate);
}

function makeEventSnapshot({
  state,
  prevState,
  changed,
  retrigger,
  context,
  eventId,
  timestamp
}) {
  return {
    state,
    prevState,
    changed,
    retrigger,
    context: cloneValue(context),
    eventId,
    timestamp
  };
}

function makeErrorEvent({
  type,
  message,
  requestedState,
  currentState,
  validStates,
  originalRequest,
  ts
}) {
  return {
    type,
    message,
    requestedState: requestedState ?? null,
    currentState: currentState ?? null,
    validStates: Array.isArray(validStates) ? validStates.slice() : [],
    originalRequest: cloneValue(originalRequest),
    ts: ts || Date.now()
  };
}

module.exports = {
  cloneValue,
  isPlainObject,
  makeErrorEvent,
  makeEventSnapshot,
  parseInitialContext,
  parseStates,
  shallowMergeContext
};

