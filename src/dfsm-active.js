"use strict";

const { attachDfsmMetadata } = require("./lib/fsm-utils");

module.exports = function(RED) {
  function DfsmOutNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const emitAll = config.emitAll === true || config.emitAll === "true";
    const filterState = typeof config.filterState === "string" ? config.filterState.trim() : "";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    function matches(snapshot) {
      return emitAll || snapshot.state === filterState;
    }

    const subscribe = typeof fsm.subscribeActiveLifecycle === "function"
      ? fsm.subscribeActiveLifecycle.bind(fsm)
      : fsm.subscribeEvents.bind(fsm);

    const unsubscribe = subscribe(function(snapshot, originalMsg) {
      if (!matches(snapshot)) {
        return;
      }

      const outMsg = originalMsg && typeof originalMsg === "object"
        ? RED.util.cloneMessage(originalMsg)
        : {};

      attachDfsmMetadata(outMsg, snapshot);

      // Prevent transition-request fields leaking from request paths into snapshots.
      if (Object.prototype.hasOwnProperty.call(outMsg, "nextState")) {
        delete outMsg.nextState;
      }

      if (outMsg.payload && typeof outMsg.payload === "object" && Object.prototype.hasOwnProperty.call(outMsg.payload, "nextState")) {
        delete outMsg.payload.nextState;
      }

      if (outMsg.dfsm && Object.prototype.hasOwnProperty.call(outMsg.dfsm, "nextState")) {
        delete outMsg.dfsm.nextState;
      }

      const statusFill = snapshot.lifecycleType === "active_interval"
        ? "yellow"
        : (snapshot.retrigger ? "blue" : "green");

      node.status({ fill: statusFill, shape: "dot", text: snapshot.state });
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

  RED.nodes.registerType("dfsm-active", DfsmOutNode);
};

