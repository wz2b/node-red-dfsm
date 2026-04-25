"use strict";

/**
 * dfsm-util-latch
 *
 * A utility node with one physical input and one output.
 *
 * It supports three logical input types.
 *
 * The runtime always treats `msg.topic === "clear"` as clear input.
 * Trigger detection is selected by `triggerSource`:
 *
 *   triggerSource = "topic" => msg.topic === "trigger" is trigger input
 *   triggerSource = "rule"  => one configured rule match is trigger input
 *
 * Any non-clear, non-trigger message is treated as normal msg input.
 *
 * Use upstream nodes (for example, Change nodes) to set `msg.topic` to
 * `"trigger"` or `"clear"` when selecting those logical input types.
 *
 * Configuration options
 * ---------------------
 * bufferMode   "one"  | "all"               – how many messages to store
 * queueMode    "release-all" | "release-one"  – how many to release per trigger
 * triggerMode  "edge" | "gate"              – when/how messages pass through
 * triggerSource "topic" | "rule"            – how a trigger is detected
 * releaseFormat "individual" | "payload-array" | "message-array" – release output shape
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
    const triggerSource = config.triggerSource === "rule" ? "rule" : "topic";
    const triggerRuleProperty = typeof config.triggerRuleProperty === "string" && config.triggerRuleProperty.trim()
      ? config.triggerRuleProperty.trim()
      : "payload";
    const triggerRuleOperator = ["eq", "neq", "contains", "exists", "truthy", "falsy"].includes(config.triggerRuleOperator)
      ? config.triggerRuleOperator
      : "exists";
    const triggerRuleValueType = ["str", "num", "bool"].includes(config.triggerRuleValueType)
      ? config.triggerRuleValueType
      : "str";
    const triggerRuleValue = config.triggerRuleValue;
    const releaseFormat = config.releaseFormat === "payload-array" || config.releaseFormat === "message-array"
      ? config.releaseFormat
      : "individual";

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

    function takeQueuedMessagesForRelease() {
      if (messages.length === 0) {
        return [];
      }

      if (queueMode === "release-one") {
        // Release only the oldest (front of the FIFO queue).
        return [messages.shift()];
      }

      // release-all: drain FIFO in arrival order.
      return messages.splice(0);
    }

    function releaseMessages(triggerMsg) {
      const triggerPayload = triggerMsg.payload;
      const released = takeQueuedMessagesForRelease();

      if (released.length === 0) {
        return;
      }

      if (releaseFormat === "individual") {
        released.forEach(function(m) {
          m.trigger = triggerPayload;
          node.send(m);
        });
        return;
      }

      const out = RED.util.cloneMessage(triggerMsg);

      // Generate the output payload in the format the config asked for.
      // Depending on the mode,this gives you:
      //    payload-array  -> msg.payload = [payload1, payload2, ...]
      //    message-array  -> msg.payload = [msg1, msg2, ...]
      if (releaseFormat === "payload-array") {
        out.payload = released.map(m => RED.util.cloneMessage(m).payload);
      } else {
        // message-array
        out.payload = released.map(m => RED.util.cloneMessage(m));
      }

      out.trigger = triggerPayload;
      node.send(out);
    }

    function resolveTypedRuleValue() {
      if (triggerRuleValueType === "num") {
        const parsed = Number(triggerRuleValue);
        return Number.isFinite(parsed) ? parsed : NaN;
      }

      if (triggerRuleValueType === "bool") {
        if (triggerRuleValue === true || triggerRuleValue === "true") {
          return true;
        }

        if (triggerRuleValue === false || triggerRuleValue === "false") {
          return false;
        }

        return Boolean(triggerRuleValue);
      }

      return triggerRuleValue === undefined || triggerRuleValue === null ? "" : String(triggerRuleValue);
    }

    function getRulePropertyValue(msg) {
      try {
        if (RED.util && typeof RED.util.getMessageProperty === "function") {
          return RED.util.getMessageProperty(msg, triggerRuleProperty);
        }
      } catch (error) {
        return undefined;
      }

      return msg ? msg[triggerRuleProperty] : undefined;
    }

    function evaluateRuleTrigger(msg) {
      const propertyValue = getRulePropertyValue(msg);

      if (triggerRuleOperator === "exists") {
        return propertyValue !== undefined;
      }

      if (triggerRuleOperator === "truthy") {
        return Boolean(propertyValue);
      }

      if (triggerRuleOperator === "falsy") {
        return !propertyValue;
      }

      const expectedValue = resolveTypedRuleValue();

      if (triggerRuleOperator === "eq") {
        return propertyValue === expectedValue;
      }

      if (triggerRuleOperator === "neq") {
        return propertyValue !== expectedValue;
      }

      if (triggerRuleOperator === "contains") {
        if (typeof propertyValue === "string") {
          return propertyValue.includes(String(expectedValue));
        }

        if (Array.isArray(propertyValue)) {
          return propertyValue.includes(expectedValue);
        }

        return false;
      }

      return false;
    }

    function isTriggerMessage(msg) {
      if (triggerSource === "topic") {
        return typeof msg.topic === "string" && msg.topic === "trigger";
      }

      return evaluateRuleTrigger(msg);
    }

    // ---------------------------------------------------------------------------
    // Input handler
    //
    // msg.topic === "clear"     → clear input (always)
    // isTriggerMessage(msg)      → trigger input (topic or rule)
    // anything else              → msg input
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

      if (isTriggerMessage(msg)) {
        // Update gate state unconditionally.
        gateOpen = !!msg.payload;

        if (triggerMode === "edge") {
          releaseMessages(msg);
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

