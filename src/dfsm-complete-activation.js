"use strict";

module.exports = function(RED) {
  function DfsmCompleteActivationNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    if (typeof fsm.completeLifecycleStep !== "function") {
      node.status({ fill: "red", shape: "ring", text: "fsm api missing" });
      node.error("FSM node does not support completeLifecycleStep. Upgrade dfsm-state-machine.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: "ready" });

    node.on("input", function(msg, send, done) {
      const result = fsm.completeLifecycleStep(msg);

      if (result.ok) {
        node.status({
          fill: "yellow",
          shape: "dot",
          text: `complete ${result.event.state}`
        });
      } else {
        node.status({
          fill: "red",
          shape: "ring",
          text: result.error ? result.error.type : "completion failed"
        });
      }

      done();
    });
  }

  RED.nodes.registerType("dfsm-complete-activation", DfsmCompleteActivationNode);
};

