"use strict";

const { attachDfsmMetadata } = require("./lib/fsm-utils");

module.exports = function(RED) {
  function DfsmStateEnterNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const selectedState = typeof config.state === "string" ? config.state.trim() : "";
    const triggerOnSelfTransition = config.triggerOnSelfTransition === true || config.triggerOnSelfTransition === "true";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    if (!selectedState) {
      node.status({ fill: "yellow", shape: "ring", text: "no state" });
    }

    let unsubscribe = function() {};

    if (selectedState) {
      unsubscribe = fsm.subscribeStateEnter({
        state: selectedState,
        triggerOnSelfTransition,
        blocking: true,
        handler: function(snapshot, originalMsg) {
          const outMsg = originalMsg && typeof originalMsg === "object"
            ? RED.util.cloneMessage(originalMsg)
            : {};

          attachDfsmMetadata(outMsg, snapshot);

          if (Object.prototype.hasOwnProperty.call(outMsg, "nextState")) {
            delete outMsg.nextState;
          }

          if (outMsg.payload && typeof outMsg.payload === "object" && Object.prototype.hasOwnProperty.call(outMsg.payload, "nextState")) {
            delete outMsg.payload.nextState;
          }

          node.status({ fill: snapshot.retrigger ? "blue" : "green", shape: "dot", text: `enter ${selectedState}` });
          node.send(outMsg);
        }
      });
    }

    node.status({ fill: "grey", shape: "ring", text: selectedState || "select state" });

    node.on("close", function() {
      unsubscribe();
    });
  }

  RED.nodes.registerType("dfsm-state-enter", DfsmStateEnterNode);
};

