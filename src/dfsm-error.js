"use strict";

module.exports = function(RED) {
  function DfsmErrorNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    const unsubscribe = fsm.subscribeErrors(function(errorEvent, originalMsg) {
      const outMsg = originalMsg && typeof originalMsg === "object"
        ? RED.util.cloneMessage(originalMsg)
        : {};

      outMsg.payload = errorEvent;
      node.status({ fill: "red", shape: "dot", text: errorEvent.type });
      node.send(outMsg);
    });

    node.status({ fill: "grey", shape: "ring", text: "listening" });

    node.on("close", function() {
      unsubscribe();
    });
  }

  RED.nodes.registerType("dfsm-error", DfsmErrorNode);
};

