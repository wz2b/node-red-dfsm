"use strict";

module.exports = function(RED) {
  function DfsmTraceNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const includeEnter = config.includeEnter === true || config.includeEnter === "true";
    const includeExit = config.includeExit === true || config.includeExit === "true";
    const includeActive = config.includeActive === true || config.includeActive === "true";
    const includeError = config.includeError === true || config.includeError === "true";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    const unsubscribeHandlers = [];

    function buildTraceMessage(traceType, event, originalMsg) {
      const eventTimestamp = event && (event.timestamp || event.ts);
      const state = event && Object.prototype.hasOwnProperty.call(event, "state") ? event.state : null;
      const prevState = event && Object.prototype.hasOwnProperty.call(event, "prevState") ? event.prevState : null;
      const changed = event && typeof event.changed === "boolean" ? event.changed : null;
      const retrigger = event && typeof event.retrigger === "boolean" ? event.retrigger : null;
      const eventId = event && Number.isFinite(event.eventId) ? event.eventId : null;

      let message = "TRACE";
      if (traceType === "state-enter") {
        message = `ENTER state ${state || "(unknown)"}`;
      } else if (traceType === "state-exit") {
        message = `EXIT state ${prevState || state || "(unknown)"}`;
      } else if (traceType === "state-active") {
        message = `ACTIVE state ${state || "(unknown)"}`;
      } else if (traceType === "dfsm-error") {
        message = `ERROR ${event && event.type ? event.type : "unknown"}`;
      }

      return {
        traceType,
        state,
        prevState,
        changed,
        retrigger,
        timestamp: eventTimestamp || Date.now(),
        eventId,
        error: traceType === "dfsm-error" ? RED.util.cloneMessage(event) : null,
        message
      };
    }

    function emitTrace(traceType, event, originalMsg) {
      const outMsg = originalMsg && typeof originalMsg === "object"
        ? RED.util.cloneMessage(originalMsg)
        : {};

      outMsg.topic = traceType;
      outMsg.payload = buildTraceMessage(traceType, event, originalMsg);
      node.status({ fill: traceType === "dfsm-error" ? "red" : "green", shape: "dot", text: traceType });
      node.send(outMsg);
    }

    if (includeEnter) {
      unsubscribeHandlers.push(fsm.subscribeStateEnter(function(snapshot, originalMsg) {
        emitTrace("state-enter", snapshot, originalMsg);
      }));
    }

    if (includeExit) {
      unsubscribeHandlers.push(fsm.subscribeStateExit(function(snapshot, originalMsg) {
        emitTrace("state-exit", snapshot, originalMsg);
      }));
    }

    if (includeActive) {
      const subscribeActive = typeof fsm.subscribeActiveLifecycle === "function"
        ? fsm.subscribeActiveLifecycle.bind(fsm)
        : fsm.subscribeEvents.bind(fsm);

      unsubscribeHandlers.push(subscribeActive(function(snapshot, originalMsg) {
        emitTrace("state-active", snapshot, originalMsg);
      }));
    }

    if (includeError) {
      unsubscribeHandlers.push(fsm.subscribeErrors(function(errorEvent, originalMsg) {
        emitTrace("dfsm-error", errorEvent, originalMsg);
      }));
    }

    node.status({
      fill: unsubscribeHandlers.length > 0 ? "grey" : "yellow",
      shape: "ring",
      text: unsubscribeHandlers.length > 0 ? "listening" : "no channels"
    });

    node.on("close", function() {
      unsubscribeHandlers.forEach(function(unsubscribe) {
        unsubscribe();
      });
    });
  }

  RED.nodes.registerType("dfsm-trace", DfsmTraceNode);
};

