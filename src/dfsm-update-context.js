"use strict";

const { isPlainObject } = require("./lib/fsm-utils");

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
      const payload = isPlainObject(msg.payload) ? msg.payload : null;

      if (!payload) {
        const error = {
          type: "malformed_payload",
          message: "msg.payload must be an object.",
          originalRequest: msg.payload
        };

        if (typeof fsm.publishError === "function") {
          fsm.publishError(error, msg);
        }

        node.status({ fill: "red", shape: "ring", text: "bad payload" });
        send(msg);
        done();
        return;
      }

      const request = {
        context: payload.context,
        replaceContext: updateMode === "replace"
      };

      if (typeof payload.state === "string" && payload.state.trim()) {
        request.state = payload.state.trim();
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

