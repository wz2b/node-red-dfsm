"use strict";

const { isPlainObject } = require("./lib/fsm-utils");

module.exports = function(RED) {
  function DfsmInNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const retriggerEnabled = config.retrigger !== false && config.retrigger !== "false";
    const defaultState = typeof config.defaultState === "string" ? config.defaultState.trim() : "";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM config node is required.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: `current ${fsm.getCurrentState()}` });

    node.on("input", function(msg, send, done) {
      const payload = msg.payload;

      if (!isPlainObject(payload)) {
        fsm.publishError({
          type: "malformed_payload",
          message: "msg.payload must be an object.",
          originalRequest: payload
        }, msg);

        node.status({ fill: "red", shape: "ring", text: "bad payload" });
        done();
        return;
      }

      const requestedState = typeof payload.state === "string" && payload.state.trim()
        ? payload.state.trim()
        : defaultState;

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

      if (!retriggerEnabled && requestedState === fsm.getCurrentState()) {
        node.status({ fill: "yellow", shape: "ring", text: `suppressed ${requestedState}` });
        done();
        return;
      }

      const request = {
        state: requestedState,
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
      } else {
        node.status({ fill: "red", shape: "ring", text: result.error.type });
      }

      // TODO: Consider optional diagnostics counters for accepted/suppressed requests.
      done();
    });
  }

  RED.nodes.registerType("dfsm-in", DfsmInNode);
};

