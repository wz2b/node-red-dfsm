"use strict";

module.exports = function(RED) {
  function DfsmAttachSnapshotNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    if (typeof fsm.getSnapshot !== "function") {
      node.status({ fill: "red", shape: "ring", text: "fsm api missing" });
      node.error("FSM node does not support getSnapshot. Upgrade dfsm-state-machine.");
      return;
    }

    node.status({ fill: "grey", shape: "ring", text: "ready" });

    node.on("input", function(msg, send, done) {
      const snapshot = fsm.getSnapshot();

      const outMsg = msg && typeof msg === "object"
        ? RED.util.cloneMessage(msg)
        : {};

      // Attach current retained FSM snapshot fields at the top level.
      // msg.payload is preserved; only DFSM snapshot fields are written.
      outMsg.state    = snapshot.state;
      outMsg.prevState = snapshot.prevState !== undefined ? snapshot.prevState : null;
      outMsg.context  = snapshot.context;
      outMsg.eventId  = snapshot.eventId;

      // Publish a trace event if the state machine supports it.
      if (typeof fsm.publishSnapshotAttached === "function") {
        const traceEvent = {
          traceType: "snapshot-attached",
          state: snapshot.state,
          prevState: snapshot.prevState !== undefined ? snapshot.prevState : null,
          context: snapshot.context,
          eventId: snapshot.eventId,
          timestamp: Date.now(),
          message: `ATTACHED SNAPSHOT for state ${snapshot.state}`
        };

        fsm.publishSnapshotAttached(traceEvent, outMsg);
      }

      node.status({ fill: "green", shape: "dot", text: snapshot.state || "(unknown)" });
      send(outMsg);
      done();
    });
  }

  RED.nodes.registerType("dfsm-attach-snapshot", DfsmAttachSnapshotNode);
};

