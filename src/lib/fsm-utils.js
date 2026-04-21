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

/**
 * Read DFSM metadata from a message, supporting both legacy and new structures.
 *
 * Legacy: top-level fields (state, prevState, context, etc.)
 * New: msg.dfsm namespace
 *
 * Returns a normalized object with all DFSM metadata fields.
 * Always returns an object; missing fields are undefined.
 */
function extractDfsmMetadata(msg) {
  if (!isPlainObject(msg)) {
    return {};
  }

  const result = {};

  // Try to read from new msg.dfsm structure first
  if (isPlainObject(msg.dfsm)) {
    result.state = msg.dfsm.state;
    result.prevState = msg.dfsm.prevState;
    result.context = msg.dfsm.context;
    result.changed = msg.dfsm.changed;
    result.retrigger = msg.dfsm.retrigger;
    result.eventId = msg.dfsm.eventId;
    result.timestamp = msg.dfsm.timestamp;
  }

  // Fall back to legacy top-level fields if not found in msg.dfsm
  if (result.state === undefined && msg.state !== undefined) {
    result.state = msg.state;
  }
  if (result.prevState === undefined && msg.prevState !== undefined) {
    result.prevState = msg.prevState;
  }
  if (result.context === undefined && msg.context !== undefined) {
    result.context = msg.context;
  }
  if (result.changed === undefined && msg.changed !== undefined) {
    result.changed = msg.changed;
  }
  if (result.retrigger === undefined && msg.retrigger !== undefined) {
    result.retrigger = msg.retrigger;
  }
  if (result.eventId === undefined && msg.eventId !== undefined) {
    result.eventId = msg.eventId;
  }
  if (result.timestamp === undefined && msg.timestamp !== undefined) {
    result.timestamp = msg.timestamp;
  }

  return result;
}

/**
 * Attach DFSM metadata snapshot to a message under msg.dfsm namespace.
 *
 * Preserves other message properties and does NOT touch msg.payload.
 * Clones the snapshot to prevent external mutations of the event.
 */
function attachDfsmMetadata(msg, snapshot) {
  const outMsg = msg && typeof msg === "object"
    ? msg
    : {};

  outMsg.dfsm = cloneValue(snapshot);
  return outMsg;
}

/**
 * Read a transition request from incoming message, supporting both legacy and new structures.
 *
 * Looks for:
 * - msg.dfsm.nextState (canonical namespace)
 * - msg.nextState (legacy top-level, still supported)
 * - msg.payload.nextState (legacy payload namespace)
 * - msg.dfsm.context (canonical namespace)
 * - msg.context (legacy top-level)
 * - msg.payload.context (legacy payload namespace)
 * - msg.dfsm.replaceContext, msg.replaceContext, msg.payload.replaceContext
 *
 * Returns normalized { nextState, context, replaceContext } object.
 */
function extractTransitionRequest(msg) {
  if (!isPlainObject(msg)) {
    return {};
  }

  const result = {};
  const payload = isPlainObject(msg.payload) ? msg.payload : {};

  // Extract nextState with priority: msg.dfsm.nextState > msg.nextState > payload.nextState
  if (isPlainObject(msg.dfsm) && typeof msg.dfsm.nextState === "string" && msg.dfsm.nextState.trim()) {
    result.nextState = msg.dfsm.nextState.trim();
  } else if (typeof msg.nextState === "string" && msg.nextState.trim()) {
    result.nextState = msg.nextState.trim();
  } else if (typeof payload.nextState === "string" && payload.nextState.trim()) {
    result.nextState = payload.nextState.trim();
  }

  // Extract present state matcher for context-only updates with priority:
  // msg.dfsm.state > msg.state > payload.state
  if (isPlainObject(msg.dfsm) && typeof msg.dfsm.state === "string" && msg.dfsm.state.trim()) {
    result.state = msg.dfsm.state.trim();
  } else if (typeof msg.state === "string" && msg.state.trim()) {
    result.state = msg.state.trim();
  } else if (typeof payload.state === "string" && payload.state.trim()) {
    result.state = payload.state.trim();
  }

  // Extract context with priority: msg.dfsm.context > msg.context > payload.context
  if (isPlainObject(msg.dfsm) && Object.prototype.hasOwnProperty.call(msg.dfsm, "context")) {
    result.context = msg.dfsm.context;
  } else if (Object.prototype.hasOwnProperty.call(msg, "context")) {
    result.context = msg.context;
  } else if (Object.prototype.hasOwnProperty.call(payload, "context")) {
    result.context = payload.context;
  }

  // Extract replaceContext with priority: msg.dfsm.replaceContext > msg.replaceContext > payload.replaceContext
  if (isPlainObject(msg.dfsm) && msg.dfsm.replaceContext === true) {
    result.replaceContext = true;
  } else if (msg.replaceContext === true) {
    result.replaceContext = true;
  } else if (payload.replaceContext === true) {
    result.replaceContext = true;
  }

  return result;
}

/**
 * Build a message for error events.
 *
 * Attaches error data under msg.dfsm with the error object,
 * preserves other message properties including msg.payload.
 */
function buildErrorMessage(msg, errorEvent) {
  const outMsg = msg && typeof msg === "object"
    ? msg
    : {};

  // Attach error metadata under msg.dfsm
  if (!isPlainObject(outMsg.dfsm)) {
    outMsg.dfsm = {};
  }
  outMsg.dfsm.error = cloneValue(errorEvent);

  return outMsg;
}

module.exports = {
  attachDfsmMetadata,
  buildErrorMessage,
  cloneValue,
  extractDfsmMetadata,
  extractTransitionRequest,
  isPlainObject,
  makeErrorEvent,
  makeEventSnapshot,
  parseAllowedTransitions,
  parseInitialContext,
  parseStates,
  shallowMergeContext
};

