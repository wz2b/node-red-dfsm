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

function parseAllowedTransitions(rawTransitions, allowedStates) {
  if (rawTransitions === undefined || rawTransitions === null || rawTransitions === "") {
    return [];
  }

  const parsed = typeof rawTransitions === "string"
    ? JSON.parse(rawTransitions || "[]")
    : rawTransitions;

  if (!Array.isArray(parsed)) {
    throw new Error("Allowed transitions must be an array of transition objects.");
  }

  const seen = new Set();

  return parsed.map((entry) => {
    if (!isPlainObject(entry)) {
      throw new Error("Each allowed transition must be an object with from and to properties.");
    }

    const from = typeof entry.from === "string" ? entry.from.trim() : "";
    const to = typeof entry.to === "string" ? entry.to.trim() : "";

    if (!from || !to) {
      throw new Error("Each allowed transition must include non-empty from and to states.");
    }

    if (from !== "*" && !allowedStates.includes(from)) {
      throw new Error(`Invalid transition source state: ${from}`);
    }

    if (to !== "*" && !allowedStates.includes(to)) {
      throw new Error(`Invalid transition target state: ${to}`);
    }

    const key = `${from}->${to}`;

    if (seen.has(key)) {
      throw new Error(`Duplicate transition rule: ${key}`);
    }

    seen.add(key);

    return { from, to };
  });
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
  parseAllowedTransitions,
  parseInitialContext,
  parseStates,
  shallowMergeContext
};

