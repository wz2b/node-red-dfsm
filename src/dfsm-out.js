"use strict";

module.exports = function(RED) {
  function DfsmOutNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const emitAll = config.emitAll === true || config.emitAll === "true";
    const filterState = typeof config.filterState === "string" ? config.filterState.trim() : "";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM config node is required.");
      return;
    }

    function matches(snapshot) {
      return emitAll || snapshot.state === filterState;
    }

    const unsubscribe = fsm.subscribeEvents(function(snapshot, originalMsg) {
      if (!matches(snapshot)) {
        return;
      }

      const outMsg = originalMsg && typeof originalMsg === "object"
        ? RED.util.cloneMessage(originalMsg)
        : {};

      // Prevent transition-request fields leaking from request paths into snapshots.
      if (Object.prototype.hasOwnProperty.call(outMsg, "nextState")) {
        delete outMsg.nextState;
      }

      outMsg.payload = snapshot;

      if (outMsg.payload && Object.prototype.hasOwnProperty.call(outMsg.payload, "nextState")) {
        delete outMsg.payload.nextState;
      }

      node.status({ fill: snapshot.retrigger ? "blue" : "green", shape: "dot", text: snapshot.state });
      node.send(outMsg);
    });

    node.status({
      fill: "grey",
      shape: "ring",
      text: emitAll ? "all states" : (filterState || "select state")
    });

    node.on("close", function() {
      unsubscribe();
    });
  }

  RED.nodes.registerType("dfsm-out", DfsmOutNode);
};

