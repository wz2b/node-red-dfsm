"use strict";

const { isPlainObject } = require("./lib/fsm-utils");

const ENABLE_ALLOWABLE_PREVIOUS_STATES_GUARD = false;

function parseStateList(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map(function(entry) { return typeof entry === "string" ? entry.trim() : ""; })
      .filter(function(entry, index, all) { return entry && all.indexOf(entry) === index; });
  }

  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return [];
  }

  const trimmedValue = rawValue.trim();

  if (trimmedValue.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedValue);
      if (Array.isArray(parsed)) {
        return parseStateList(parsed);
      }
    } catch (error) {
      // Fall through to legacy comma-separated parsing.
    }
  }

  const seen = new Set();
  const states = [];

  trimmedValue.split(",").forEach(function(entry) {
    const trimmed = entry.trim();

    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    states.push(trimmed);
  });

  return states;
}

function normalizeStateValue(rawValue) {
  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : "";
}

function resolveRequestedState(msg, payload, defaultState) {
  const nextFromPayload = normalizeStateValue(payload.nextState);
  if (nextFromPayload) {
    return nextFromPayload;
  }

  const nextFromMessage = normalizeStateValue(msg.nextState);
  if (nextFromMessage) {
    return nextFromMessage;
  }

  return defaultState;
}

module.exports = function(RED) {
  function DfsmInNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const retriggerEnabled = config.retrigger !== false && config.retrigger !== "false";
    const defaultState = typeof config.defaultState === "string" ? config.defaultState.trim() : "";
    const allowablePreviousStates = parseStateList(config.allowablePreviousStates);

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM config node is required.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: `current ${fsm.getCurrentState()}` });

    node.on("input", function(msg, send, done) {
      const payload = isPlainObject(msg.payload) ? msg.payload : {};
      const hasTopLevelNextState = normalizeStateValue(msg.nextState) !== "";

      if (!isPlainObject(msg.payload) && msg.payload !== undefined && msg.payload !== null && !hasTopLevelNextState) {
        fsm.publishError({
          type: "malformed_payload",
          message: "msg.payload must be an object when nextState is not provided on msg.nextState.",
          originalRequest: msg.payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "bad payload" });
        done();
        return;
      }

      const requestedState = resolveRequestedState(msg, payload, defaultState);

      if (!requestedState) {
        fsm.publishError({
          type: "missing_state",
          message: "No state was supplied and no default next state is configured.",
          originalRequest: payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "missing state" });
        done();
        return;
      }

      const currentState = fsm.getCurrentState();

      if (ENABLE_ALLOWABLE_PREVIOUS_STATES_GUARD && allowablePreviousStates.length > 0 && !allowablePreviousStates.includes(currentState)) {
        const warningMessage = `Illegal transition to \"${requestedState}\" from \"${currentState}\". `
          + `Allowable Previous States: [${allowablePreviousStates.join(", ")}]`;

        node.warn(warningMessage);
        fsm.publishError({
          type: "illegal_transition",
          message: warningMessage,
          requestedState,
          originalRequest: payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "illegal transition" });
        done();
        return;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "context") && !isPlainObject(payload.context)) {
        fsm.publishError({
          type: "non_object_context",
          message: "msg.payload.context must be a plain object.",
          requestedState,
          originalRequest: payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "bad context" });
        done();
        return;
      }

      if (payload.replaceContext === true && !Object.prototype.hasOwnProperty.call(payload, "context")) {
        fsm.publishError({
          type: "missing_context",
          message: "replaceContext=true requires msg.payload.context.",
          requestedState,
          originalRequest: payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "missing context" });
        done();
        return;
      }

      if (!retriggerEnabled && requestedState === currentState) {
        node.status({ fill: "yellow", shape: "ring", text: `suppressed ${requestedState}` });
        done();
        return;
      }

      const request = {
        nextState: requestedState,
        replaceContext: payload.replaceContext === true
      };

      if (Object.prototype.hasOwnProperty.call(payload, "context")) {
        request.context = payload.context;
      }

      const result = fsm.next(request, msg);

      if (result.ok) {
        const statusText = result.event.retrigger
          ? `retrigger ${result.event.state}`
          : `${result.event.prevState || "none"}→${result.event.state}`;

        node.status({ fill: result.event.retrigger ? "blue" : "green", shape: "dot", text: statusText });
      } else if (result.error && result.error.type === "illegal_transition") {
        const fsmLabel = fsm.name || fsm.id || "fsm";
        node.warn(`illegal transition: ${result.error.currentState} -> ${result.error.requestedState} (${fsmLabel})`);
        node.status({ fill: "red", shape: "ring", text: "illegal transition" });
      } else {
        node.status({ fill: "red", shape: "ring", text: result.error.type });
      }

      // TODO: Consider optional diagnostics counters for accepted/suppressed requests.
      done();
    });
  }

  RED.nodes.registerType("dfsm-in", DfsmInNode);
};
