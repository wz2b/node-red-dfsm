"use strict";

module.exports = function(RED) {
  function DfsmSummaryNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const fsm = RED.nodes.getNode(config.fsm);
    const format = (typeof config.format === "string" && config.format === "html") ? "html" : "markdown";

    if (!fsm) {
      node.status({ fill: "red", shape: "ring", text: "no fsm" });
      node.error("FSM state machine node is required.");
      return;
    }

    function buildSummaryModel() {
      const snapshot = typeof fsm.getSnapshot === "function" ? fsm.getSnapshot() : {};
      const states = typeof fsm.getAllowedStates === "function" ? fsm.getAllowedStates() : [];
      const transitions = typeof fsm.getAllowedTransitions === "function" ? fsm.getAllowedTransitions() : [];
      const interval = typeof fsm.getIntervalSettings === "function" ? fsm.getIntervalSettings() : null;
      const machineName = typeof fsm.name === "string" && fsm.name.trim() ? fsm.name.trim() : "(unnamed)";
      const initialState = snapshot && typeof snapshot.initialState === "string" && snapshot.initialState
        ? snapshot.initialState
        : "(not set)";

      const transitionList = Array.isArray(transitions) ? transitions.map(function(rule) {
        return {
          from: typeof rule.from === "string" && rule.from ? rule.from : "*",
          to: typeof rule.to === "string" && rule.to ? rule.to : "*"
        };
      }) : [];

      let intervalModel = null;
      if (interval && typeof interval === "object") {
        intervalModel = {
          enabled: interval.enabled === true ? "true" : "false",
          intervalMs: Number.isFinite(interval.intervalMs) ? interval.intervalMs : 1000,
          policy: interval.policy || null,
          mode: interval.mode || null
        };
      }

      return {
        machineName: machineName,
        initialState: initialState,
        states: Array.isArray(states) ? states : [],
        transitions: transitionList,
        interval: intervalModel
      };
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderSummaryMarkdown(model) {
      const lines = [
        "# DFSM Summary",
        "",
        "## State Machine",
        `- Name: ${model.machineName}`,
        `- Initial state: ${model.initialState}`,
        "",
        "## States"
      ];

      if (model.states.length > 0) {
        model.states.forEach(function(state) {
          lines.push(`- ${state}`);
        });
      } else {
        lines.push("- (none)");
      }

      lines.push("", "## Allowed Transitions");

      if (model.transitions.length > 0) {
        model.transitions.forEach(function(rule) {
          lines.push(`- ${rule.from} -> ${rule.to}`);
        });
      } else {
        lines.push("- (none configured; all valid transitions are allowed)");
      }

      if (model.interval) {
        lines.push("", "## Interval");
        lines.push(`- Enabled: ${model.interval.enabled}`);
        lines.push(`- Interval ms: ${model.interval.intervalMs}`);
        if (model.interval.policy) {
          lines.push(`- Policy: ${model.interval.policy}`);
        }
        if (model.interval.mode) {
          lines.push(`- Mode: ${model.interval.mode}`);
        }
      }

      return `${lines.join("\n")}\n`;
    }

    function renderSummaryHtml(model) {
      const parts = [];
      parts.push("<h1>DFSM Summary</h1>");
      parts.push("<h2>State Machine</h2>");
      parts.push("<ul>");
      parts.push(`<li><strong>Name:</strong> ${escapeHtml(model.machineName)}</li>`);
      parts.push(`<li><strong>Initial state:</strong> ${escapeHtml(model.initialState)}</li>`);
      parts.push("</ul>");

      parts.push("<h2>States</h2>");
      parts.push("<ul>");
      if (model.states.length > 0) {
        model.states.forEach(function(state) {
          parts.push(`<li>${escapeHtml(state)}</li>`);
        });
      } else {
        parts.push("<li>(none)</li>");
      }
      parts.push("</ul>");

      parts.push("<h2>Allowed Transitions</h2>");
      parts.push("<ul>");
      if (model.transitions.length > 0) {
        model.transitions.forEach(function(rule) {
          parts.push(`<li>${escapeHtml(rule.from)} -&gt; ${escapeHtml(rule.to)}</li>`);
        });
      } else {
        parts.push("<li>(none configured; all valid transitions are allowed)</li>");
      }
      parts.push("</ul>");

      if (model.interval) {
        parts.push("<h2>Interval</h2>");
        parts.push("<ul>");
        parts.push(`<li><strong>Enabled:</strong> ${escapeHtml(model.interval.enabled)}</li>`);
        parts.push(`<li><strong>Interval ms:</strong> ${escapeHtml(String(model.interval.intervalMs))}</li>`);
        if (model.interval.policy) {
          parts.push(`<li><strong>Policy:</strong> ${escapeHtml(model.interval.policy)}</li>`);
        }
        if (model.interval.mode) {
          parts.push(`<li><strong>Mode:</strong> ${escapeHtml(model.interval.mode)}</li>`);
        }
        parts.push("</ul>");
      }

      return parts.join("\n") + "\n";
    }

    node.status({ fill: "grey", shape: "ring", text: "ready" });

    node.on("input", function(msg, send, done) {
      const outMsg = msg && typeof msg === "object"
        ? RED.util.cloneMessage(msg)
        : {};

      const model = buildSummaryModel();
      outMsg.payload = format === "html" ? renderSummaryHtml(model) : renderSummaryMarkdown(model);
      node.status({ fill: "green", shape: "dot", text: "emitted" });
      send(outMsg);
      done();
    });
  }

  RED.nodes.registerType("dfsm-summary", DfsmSummaryNode);
};

