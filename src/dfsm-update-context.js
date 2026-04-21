"use strict";

const { isPlainObject, extractTransitionRequest } = require("./lib/fsm-utils");

module.exports = function(RED) {
  function DfsmUpdateContextNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const updateMode = config.mode === "replace" ? "replace" : "merge";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    if (typeof fsm.updateContextOnly !== "function") {
      node.status({ fill: "red", shape: "ring", text: "fsm api missing" });
      node.error("Selected FSM does not support context-only updates.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: `${updateMode} mode` });

    node.on("input", function(msg, send, done) {
      // Support both legacy (msg.payload) and new (msg.dfsm) structures
      const transitionRequest = extractTransitionRequest(msg);
      const payload = isPlainObject(msg.payload) ? msg.payload : null;

      // Extract context from either source
      let contextToUpdate = transitionRequest.context;
      if (!contextToUpdate && payload && isPlainObject(payload.context)) {
        contextToUpdate = payload.context;
      }

      if (!contextToUpdate) {
        const error = {
          type: "malformed_payload",
          message: "Context must be provided via msg.dfsm.context, msg.payload.context, or msg.context.",
          originalRequest: msg.payload || msg.dfsm
        };

        if (typeof fsm.publishError === "function") {
          fsm.publishError(error, msg);
        }

        node.status({ fill: "red", shape: "ring", text: "bad payload" });
        send(msg);
        done();
        return;
      }

      let stateValue = transitionRequest.state;
      if (!stateValue && typeof payload === "object" && typeof payload.state === "string" && payload.state.trim()) {
        stateValue = payload.state.trim();
      }

      const request = {
        context: contextToUpdate,
        replaceContext: updateMode === "replace"
      };

      if (stateValue) {
        request.state = stateValue;
      }

      const result = fsm.updateContextOnly(request, msg);

      if (result.ok) {
        node.status({ fill: "green", shape: "dot", text: `updated ${result.event.state}` });
      } else {
        node.status({ fill: "red", shape: "ring", text: result.error ? result.error.type : "update failed" });
      }

      send(msg);
      done();
    });
  }

  RED.nodes.registerType("dfsm-update-context", DfsmUpdateContextNode);
};

