"use strict";

/**
 * dfsm-util-latch
 *
 * A utility node with three logical inputs and one output.
 *
 * In Node-RED, all three logical inputs arrive at the same runtime `input`
 * handler.  The node distinguishes them by `msg.topic`:
 *
 *   msg.topic absent or anything not "trigger" / "clear"  →  input 0: msg
 *   msg.topic === "trigger"                               →  input 1: trigger
 *   msg.topic === "clear"                                 →  input 2: clear
 *
 * The node editor shows three visual input ports.  Users should connect
 * message sources as described above, setting msg.topic upstream when
 * necessary to select the trigger or clear port.
 *
 * Configuration options
 * ---------------------
 * bufferMode   "one"  | "all"               – how many messages to store
 * queueMode    "release-all" | "release-one"  – how many to release per trigger
 * triggerMode  "edge" | "gate"              – when/how messages pass through
 *
 * Trigger modes
 * -------------
 * edge – messages on the msg input are queued; a trigger releases them.
 * gate – no queue; messages pass through immediately when the gate is open
 *        (last trigger payload was truthy) or are discarded when closed.
 *
 * FIFO ordering
 * -------------
 * Messages are always released in arrival order.  release-one releases the
 * oldest stored message (front of the queue).
 */

module.exports = function(RED) {
  function DfsmUtilLatchNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;

    // Resolve config with safe defaults.
    const bufferMode  = config.bufferMode  === "all"         ? "all"         : "one";
    const queueMode   = config.queueMode   === "release-one" ? "release-one" : "release-all";
    const triggerMode = config.triggerMode === "gate"        ? "gate"        : "edge";

    // Internal state.
    let messages = [];    // FIFO queue of cloned messages (edge mode only)
    let gateOpen = false; // current gate state (gate mode only); starts closed

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function updateStatus() {
      if (triggerMode === "gate") {
        node.status({
          fill:  gateOpen ? "green" : "grey",
          shape: "ring",
          text:  gateOpen ? "open" : "closed"
        });
      } else {
        node.status({
          fill:  messages.length > 0 ? "yellow" : "grey",
          shape: "ring",
          text:  `queued: ${messages.length}`
        });
      }
    }

    function releaseMessages(triggerPayload) {
      if (messages.length === 0) {
        return;
      }

      if (queueMode === "release-one") {
        // Release only the oldest (front of the FIFO queue).
        const out = messages.shift();
        out.trigger = triggerPayload;
        node.send(out);
      } else {
        // release-all: drain FIFO in arrival order.
        const batch = messages.splice(0);
        batch.forEach(function(m) {
          m.trigger = triggerPayload;
          node.send(m);
        });
      }
    }

    // ---------------------------------------------------------------------------
    // Input handler
    //
    // msg.topic === "trigger"  →  trigger input
    // msg.topic === "clear"    →  clear input
    // anything else            →  msg input
    // ---------------------------------------------------------------------------

    node.on("input", function(msg, send, done) {
      const topic = typeof msg.topic === "string" ? msg.topic : "";

      if (topic === "clear") {
        // Discard all queued messages without releasing them.
        messages = [];
        updateStatus();
        done();
        return;
      }

      if (topic === "trigger") {
        const triggerPayload = msg.payload;

        // Update gate state unconditionally.
        gateOpen = !!triggerPayload;

        if (triggerMode === "edge") {
          releaseMessages(triggerPayload);
        }
        // In gate mode, the trigger only changes the open/closed state.
        // No output is produced from a trigger message in gate mode.

        updateStatus();
        done();
        return;
      }

      // --- msg input (topic is anything else) ---

      const cloned = RED.util.cloneMessage(msg);

      if (triggerMode === "gate") {
        if (gateOpen) {
          // Pass through immediately; do not queue.
          node.send(cloned);
        }
        // If closed, discard – gate mode does not buffer.
        updateStatus();
        done();
        return;
      }

      // edge mode: buffer the incoming message.
      if (bufferMode === "all") {
        messages.push(cloned);
      } else {
        // "one" – keep only the most recent message; discard previous.
        messages = [cloned];
      }

      updateStatus();
      done();
    });

    // Initialise status on startup.
    updateStatus();

    node.on("close", function() {
      messages = [];
    });
  }

  RED.nodes.registerType("dfsm-util-latch", DfsmUtilLatchNode);
};

