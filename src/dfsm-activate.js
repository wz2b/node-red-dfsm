"use strict";

const { isPlainObject, extractTransitionRequest } = require("./lib/fsm-utils");

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


module.exports = function(RED) {
  function DfsmInNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const retriggerOnSameState = config.retrigger !== false && config.retrigger !== "false";
    const defaultState = typeof config.defaultState === "string" ? config.defaultState.trim() : "";
    const allowablePreviousStates = parseStateList(config.allowablePreviousStates);

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: `current ${fsm.getCurrentState()}` });

    node.on("input", function(msg, send, done) {
      // Extract transition request supporting both new (msg.dfsm) and legacy (msg.payload) structures
      const request = extractTransitionRequest(msg);
      const requestedState = request.nextState || defaultState;

      // Support legacy top-level msg.nextState as well
      if (!requestedState && normalizeStateValue(msg.nextState) !== "") {
        request.nextState = msg.nextState.trim();
      }

      const hasTopLevelNextState = normalizeStateValue(msg.nextState) !== "";

      // Validate payload format if present and nextState not provided elsewhere
      if (!requestedState && !hasTopLevelNextState) {
        if (!isPlainObject(msg.payload) && msg.payload !== undefined && msg.payload !== null) {
          fsm.publishError({
            type: "malformed_payload",
            message: "msg.payload must be an object when nextState is not provided.",
            originalRequest: msg.payload
          }, msg);

          node.status({ fill: "red", shape: "ring", text: "bad payload" });
          done();
          return;
        }
      }

      const resolvedState = request.nextState || defaultState;

      if (!resolvedState) {
        fsm.publishError({
          type: "missing_state",
          message: "No state was supplied and no default next state is configured.",
          originalRequest: request
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "missing state" });
        done();
        return;
      }

      const currentState = fsm.getCurrentState();

      if (ENABLE_ALLOWABLE_PREVIOUS_STATES_GUARD && allowablePreviousStates.length > 0 && !allowablePreviousStates.includes(currentState)) {
        const warningMessage = `Illegal transition to \"${resolvedState}\" from \"${currentState}\". `
          + `Allowable Previous States: [${allowablePreviousStates.join(", ")}]`;

        node.warn(warningMessage);
        fsm.publishError({
          type: "illegal_transition",
          message: warningMessage,
          requestedState: resolvedState,
          originalRequest: request
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "illegal transition" });
        done();
        return;
      }

      if (request.context !== undefined && !isPlainObject(request.context)) {
        fsm.publishError({
          type: "non_object_context",
          message: "Context must be a plain object.",
          requestedState: resolvedState,
          originalRequest: request
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "bad context" });
        done();
        return;
      }

      if (request.replaceContext === true && request.context === undefined) {
        fsm.publishError({
          type: "missing_context",
          message: "replaceContext=true requires context to be provided.",
          requestedState: resolvedState,
          originalRequest: request
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "missing context" });
        done();
        return;
      }

      const fsmRequest = {
        nextState: resolvedState,
        replaceContext: request.replaceContext === true
      };

      if (request.context !== undefined) {
        fsmRequest.context = request.context;
      }

      if (resolvedState === currentState && !retriggerOnSameState) {
        if (typeof fsm.activationCompleted !== "function") {
          fsm.publishError({
            type: "invalid_configuration",
            message: "FSM does not support activation-completion semantics.",
            requestedState: resolvedState,
            originalRequest: fsmRequest
          }, msg);

          node.status({ fill: "red", shape: "ring", text: "fsm api missing" });
          done();
          return;
        }

        const completionResult = fsm.activationCompleted(fsmRequest, msg);

        if (completionResult.ok) {
          node.status({ fill: "yellow", shape: "dot", text: `completed ${completionResult.event.state}` });
        } else {
          node.status({
            fill: "red",
            shape: "ring",
            text: completionResult.error ? completionResult.error.type : "completion failed"
          });
        }

        done();
        return;
      }

      const result = fsm.next(fsmRequest, msg);

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

      // TODO: Consider optional diagnostics counters for accepted/retrigger/completed requests.
      done();
    });
  }

  RED.nodes.registerType("dfsm-activate", DfsmInNode);
};
