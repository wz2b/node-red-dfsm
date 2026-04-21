"use strict";

const assert = require("assert");

const originalConsoleLog = console.log;
console.log = function(...args) {
  if (typeof args[0] === "object" && args[0] && /Cannot find the NR source tree/.test(String(args[0].message))) {
    return;
  }

  originalConsoleLog.apply(console, args);
};

const helper = require("node-red-node-test-helper");
console.log = originalConsoleLog;
const { initializeHelperRuntime } = require("./runtime-init");

const dfsmConfigNode  = require("../src/dfsm-state-machine.js");
const dfsmInNode      = require("../src/dfsm-activate.js");
const dfsmOutNode     = require("../src/dfsm-active.js");
const dfsmErrorNode   = require("../src/dfsm-error.js");
const dfsmUpdateContextNode = require("../src/dfsm-update-context.js");
const dfsmSummaryNode = require("../src/dfsm-summary.js");
const dfsmTraceNode   = require("../src/dfsm-trace.js");
const dfsmLatchNode   = require("../src/dfsm-util-latch.js");
const dfsmStateEnterNode = require("../src/dfsm-state-enter.js");
const dfsmStateExitNode = require("../src/dfsm-state-exit.js");
const dfsmCompleteActivationNode = require("../src/dfsm-complete-activation.js");
const dfsmAttachSnapshotNode = require("../src/dfsm-attach-snapshot.js");

initializeHelperRuntime(helper);

const nodes = [
  dfsmConfigNode,
  dfsmInNode,
  dfsmOutNode,
  dfsmErrorNode,
  dfsmUpdateContextNode,
  dfsmSummaryNode,
  dfsmTraceNode,
  dfsmLatchNode,
  dfsmStateEnterNode,
  dfsmStateExitNode,
  dfsmCompleteActivationNode,
  dfsmAttachSnapshotNode
];

describe("explicit DFSM nodes", function() {
  beforeEach(function(done) {
    helper.startServer(done);
  });

  afterEach(function(done) {
    helper.unload();
    helper.stopServer(done);
  });

  it("loads the config node and initializes retained state", function(done) {
    const flow = [{
      id: "cfg",
      type: "dfsm-state-machine",
      name: "machine",
      states: '["IDLE","RUNNING"]',
      initialState: "IDLE",
      initialContext: '{"counter":0}'
    }];

    helper.load(nodes, flow, function() {
      try {
        const cfg = helper.getNode("cfg");
        const snapshot = cfg.getSnapshot();

        assert.strictEqual(snapshot.state, "IDLE");
        assert.strictEqual(snapshot.prevState, null);
        assert.strictEqual(snapshot.eventId, 0);
        assert.deepStrictEqual(snapshot.context, { counter: 0 });
        assert.deepStrictEqual(snapshot.allowedStates, ["IDLE", "RUNNING"]);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it("emits accepted FSM events with merged context", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"counter":0,"nested":{"keep":true}}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.changed, true);
          assert.strictEqual(msg.payload.retrigger, false);
          assert.strictEqual(msg.payload.eventId, 1);
          assert.deepStrictEqual(msg.payload.context, {
            counter: 1,
            nested: { replaced: true }
          });
          assert.deepStrictEqual(cfg.getContext(), {
            counter: 1,
            nested: { replaced: true }
          });
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({
        payload: {
          nextState: "RUNNING",
          context: {
            counter: 1,
            nested: { replaced: true }
          }
        }
      });
    });
  });

  it("supports same-state retriggers and replaceContext", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{"counter":1,"group":{"a":1}}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "RUNNING");
          assert.strictEqual(msg.payload.changed, false);
          assert.strictEqual(msg.payload.retrigger, true);
          assert.deepStrictEqual(msg.payload.context, { group: { b: 2 } });
          assert.deepStrictEqual(cfg.getContext(), { group: { b: 2 } });
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({
        payload: {
          nextState: "RUNNING",
          context: { group: { b: 2 } },
          replaceContext: true
        }
      });
    });
  });

  it("completes same-state requests in place when retrigger is disabled", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"count":0}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: false
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");
      let triggered = false;

      out.on("input", function() {
        triggered = true;
      });

      input.receive({ payload: { nextState: "IDLE", context: { count: 1 } } });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          assert.strictEqual(cfg.getEventId(), 0);
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
          assert.deepStrictEqual(cfg.getContext(), { count: 1 });

          const hadCompletedStatus = input.status.args.some(function(args) {
            const status = args[0] || {};
            return status.fill === "yellow" && status.shape === "dot" && status.text === "completed IDLE";
          });
          assert.strictEqual(hadCompletedStatus, true);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("uses same in-place completion semantics when interval scheduling is enabled", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"count":0}',
        intervalEnabled: true,
        intervalMs: 500,
        intervalPolicy: "skip",
        intervalMode: "fixed_rate"
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: false
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");
      let triggered = false;

      out.on("input", function() {
        triggered = true;
      });

      input.receive({ payload: { nextState: "IDLE", context: { count: 2 } } });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          assert.strictEqual(cfg.getEventId(), 0);
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
          assert.deepStrictEqual(cfg.getContext(), { count: 2 });
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("executes exactly one path per input: transition, retrigger, or completion", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "in-complete",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: false
      },
      {
        id: "in-retrigger",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true
      }
    ];

    helper.load(nodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const completeNode = helper.getNode("in-complete");
      const retriggerNode = helper.getNode("in-retrigger");

      let nextCalls = 0;
      let completionCalls = 0;
      const originalNext = cfg.next.bind(cfg);
      const originalCompletion = cfg.activationCompleted.bind(cfg);

      cfg.next = function(request, msg) {
        nextCalls += 1;
        return originalNext(request, msg);
      };

      cfg.activationCompleted = function(request, msg) {
        completionCalls += 1;
        return originalCompletion(request, msg);
      };

      completeNode.receive({ payload: { nextState: "IDLE" } });
      completeNode.receive({ payload: { nextState: "RUNNING" } });
      retriggerNode.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          // same-state + retrigger disabled -> completion path only
          // different-state -> transition path only
          // same-state + retrigger enabled -> immediate retrigger via transition path
          assert.strictEqual(completionCalls, 1);
          assert.strictEqual(nextCalls, 2);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("emits explicit errors and preserves FSM state for invalid transitions", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{"setpoint":1.1}'
      },
      {
        id: "err",
        type: "dfsm-error",
        fsm: "cfg",
        wires: [["helper-error"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true
      },
      { id: "helper-error", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const err = helper.getNode("helper-error");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");

      err.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.type, "invalid_state");
          assert.strictEqual(msg.payload.requestedState, "SANDWICH");
          assert.strictEqual(msg.payload.currentState, "RUNNING");
          assert.deepStrictEqual(msg.payload.validStates, ["IDLE", "RUNNING", "STOPPED"]);
          assert.deepStrictEqual(cfg.getContext(), { setpoint: 1.1 });
          assert.strictEqual(cfg.getCurrentState(), "RUNNING");
          assert.strictEqual(cfg.getEventId(), 0);
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "SANDWICH" } });
    });
  });

  it("uses the default next state when no requested next state is provided", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true,
        defaultState: "RUNNING"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: {} });
    });
  });

  it("ignores payload.state snapshots and uses defaultState when nextState is absent", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["STARTING","RUNNING","STOPPING"]',
        initialState: "RUNNING",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "STOPPING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        defaultState: "STOPPING"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "STOPPING");
          assert.strictEqual(msg.payload.prevState, "RUNNING");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({
        payload: {
          state: "RUNNING", // snapshot current state from dfsm-active should be ignored
          prevState: "STARTING",
          changed: true,
          retrigger: false,
          context: {}
        }
      });
    });
  });

  it("prefers payload.nextState over msg.nextState", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING","STOPPING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" }, nextState: "STOPPING" });
    });
  });

  it("accepts msg.nextState alias when payload.nextState is not provided", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: {}, nextState: "RUNNING" });
    });
  });

  it("dfsm-active scrubs transition-request fields from emitted snapshots", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING","STOPPING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.nextState, undefined);
          assert.strictEqual(msg.nextState, undefined);
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" }, nextState: "STOPPING" });
    });
  });

  it("emits non_object_context errors without mutating retained state", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"safe":true}'
      },
      {
        id: "err",
        type: "dfsm-error",
        fsm: "cfg",
        wires: [["helper-error"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-error", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const err = helper.getNode("helper-error");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");

      err.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.type, "non_object_context");
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
          assert.deepStrictEqual(cfg.getContext(), { safe: true });
          assert.strictEqual(cfg.getEventId(), 0);
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING", context: [] } });
    });
  });

  it("allows transitions when Allowable Previous States is empty", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true,
        allowablePreviousStates: "   ,   "
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("ignores legacy string Allowable Previous States values", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["STARTING","RUNNING","STOPPED"]',
        initialState: "STARTING",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        allowablePreviousStates: "STARTING,READY"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "STARTING");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("ignores JSON-array config for Allowable Previous States", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["STARTING","RUNNING","STOPPED"]',
        initialState: "STARTING",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        allowablePreviousStates: '["STARTING","READY"]'
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "STARTING");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("does not block transitions when Allowable Previous States would otherwise reject them", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","STARTING","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        allowablePreviousStates: "STARTING"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(cfg.getCurrentState(), "RUNNING");
          assert.strictEqual(input.warn.called, false);

          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("allows transitions when no global allowed-transition rules are configured", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}',
        allowedTransitions: '[]'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("accepts configured legal global transitions", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","STARTING","RUNNING","FAULT"]',
        initialState: "IDLE",
        initialContext: '{}',
        allowedTransitions: '[{"from":"IDLE","to":"STARTING"},{"from":"STARTING","to":"RUNNING"}]'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "STARTING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "STARTING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "STARTING" } });
    });
  });

  it("accepts wildcard global transitions", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING","FAULT"]',
        initialState: "RUNNING",
        initialContext: '{}',
        allowedTransitions: '[{"from":"*","to":"FAULT"}]'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "FAULT",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "FAULT");
          assert.strictEqual(msg.payload.prevState, "RUNNING");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "FAULT" } });
    });
  });

  it("accepts wildcard target-state transitions such as STARTING -> *", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","STARTING","RUNNING","STOPPING","FAULT"]',
        initialState: "STARTING",
        initialContext: '{}',
        allowedTransitions: '[{"from":"STARTING","to":"*"}]'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "STARTING");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("rejects illegal global transitions before state mutation or accepted output dispatch", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","STARTING","RUNNING","FAULT"]',
        initialState: "IDLE",
        initialContext: '{"safe":true}',
        allowedTransitions: '[{"from":"IDLE","to":"STARTING"},{"from":"STARTING","to":"RUNNING"},{"from":"*","to":"FAULT"}]'
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "err",
        type: "dfsm-error",
        fsm: "cfg",
        wires: [["helper-error"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" },
      { id: "helper-error", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const err = helper.getNode("helper-error");
      const input = helper.getNode("in");
      const cfg = helper.getNode("cfg");
      let acceptedEventSeen = false;

      out.on("input", function() {
        acceptedEventSeen = true;
      });

      err.on("input", function(msg) {
        setTimeout(function() {
          try {
            assert.strictEqual(msg.payload.type, "illegal_transition");
            assert.strictEqual(msg.payload.currentState, "IDLE");
            assert.strictEqual(msg.payload.requestedState, "RUNNING");
            assert.strictEqual(cfg.getCurrentState(), "IDLE");
            assert.strictEqual(cfg.getEventId(), 0);
            assert.deepStrictEqual(cfg.getContext(), { safe: true });
            assert.strictEqual(acceptedEventSeen, false);

            assert.strictEqual(input.warn.called, true);
            const warnedMessage = input.warn.args[0] && input.warn.args[0][0] ? String(input.warn.args[0][0]) : "";
            assert.ok(warnedMessage.includes("illegal transition"));
            assert.ok(warnedMessage.includes("IDLE -> RUNNING"));

            const hadIllegalStatus = input.status.args.some(function(args) {
              const status = args[0];
              return status && status.fill === "red" && status.text === "illegal transition";
            });
            assert.strictEqual(hadIllegalStatus, true);
            done();
          } catch (error) {
            done(error);
          }
        }, 50);
      });

      input.receive({ payload: { nextState: "RUNNING", context: { safe: false } } });
    });
  });

  it("emits state-exit then state-enter on normal transitions", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "enter",
        type: "dfsm-state-enter",
        fsm: "cfg",
        state: "RUNNING",
        triggerOnSelfTransition: false,
        wires: [["helper-enter"]]
      },
      {
        id: "exit",
        type: "dfsm-state-exit",
        fsm: "cfg",
        state: "IDLE",
        triggerOnSelfTransition: false,
        wires: [["helper-exit"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-enter", type: "helper" },
      { id: "helper-exit", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const enter = helper.getNode("helper-enter");
      const exit = helper.getNode("helper-exit");
      const seen = [];

      function maybeDone() {
        if (seen.length === 2) {
          try {
            assert.deepStrictEqual(seen, ["exit", "enter"]);
            done();
          } catch (error) {
            done(error);
          }
        }
      }

      exit.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.retrigger, false);
          seen.push("exit");
          maybeDone();
        } catch (error) {
          done(error);
        }
      });

      enter.on("input", function(msg) {
        try {
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.retrigger, false);
          seen.push("enter");
          maybeDone();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });

  it("does not emit state-enter/state-exit on self transition by default", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{}'
      },
      {
        id: "enter",
        type: "dfsm-state-enter",
        fsm: "cfg",
        state: "RUNNING",
        triggerOnSelfTransition: false,
        wires: [["helper-enter"]]
      },
      {
        id: "exit",
        type: "dfsm-state-exit",
        fsm: "cfg",
        state: "RUNNING",
        triggerOnSelfTransition: false,
        wires: [["helper-exit"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-enter", type: "helper" },
      { id: "helper-exit", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const enter = helper.getNode("helper-enter");
      const exit = helper.getNode("helper-exit");
      let enterSeen = false;
      let exitSeen = false;

      enter.on("input", function() {
        enterSeen = true;
      });

      exit.on("input", function() {
        exitSeen = true;
      });

      input.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          assert.strictEqual(enterSeen, false);
          assert.strictEqual(exitSeen, false);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("does not emit state-enter/state-exit on accepted same-state requests", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{}'
      },
      {
        id: "enter",
        type: "dfsm-state-enter",
        fsm: "cfg",
        state: "RUNNING",
        triggerOnSelfTransition: true,
        wires: [["helper-enter"]]
      },
      {
        id: "exit",
        type: "dfsm-state-exit",
        fsm: "cfg",
        state: "RUNNING",
        triggerOnSelfTransition: true,
        wires: [["helper-exit"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-enter", type: "helper" },
      { id: "helper-exit", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const enter = helper.getNode("helper-enter");
      const exit = helper.getNode("helper-exit");
      let enterSeen = false;
      let exitSeen = false;

      enter.on("input", function(msg) {
        try {
          enterSeen = true;
        } catch (error) {
          done(error);
        }
      });

      exit.on("input", function(msg) {
        try {
          exitSeen = true;
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          assert.strictEqual(enterSeen, false);
          assert.strictEqual(exitSeen, false);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("emits periodic active lifecycle messages from dfsm-state-machine when interval is enabled", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}',
        intervalEnabled: true,
        intervalMs: 30,
        intervalPolicy: "skip",
        intervalMode: "fixed_rate"
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      let intervalSeen = false;

      out.on("input", function(msg) {
        try {
          if (msg.payload.lifecycleType === "active_interval") {
            intervalSeen = true;
          }
        } catch (error) {
          done(error);
        }
      });

      setTimeout(function() {
        try {
          assert.strictEqual(intervalSeen, true);
          done();
        } catch (error) {
          done(error);
        }
      }, 140);
    });
  });

  it("keeps interval cycle unresolved across accepted same-state requests", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{}',
        intervalEnabled: true,
        intervalMs: 30,
        intervalPolicy: "skip",
        intervalMode: "fixed_rate"
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg",
        retrigger: true
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      const input = helper.getNode("in");
      let intervalCount = 0;

      out.on("input", function(msg) {
        if (msg.payload.lifecycleType === "active_interval") {
          intervalCount += 1;
        }
      });

      setTimeout(function() {
        try {
          assert.strictEqual(intervalCount, 1);
          input.receive({ payload: { nextState: "RUNNING" } });
        } catch (error) {
          done(error);
        }
      }, 110);

      setTimeout(function() {
        try {
          assert.strictEqual(intervalCount, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 260);
    });
  });

  it("does not emit multiple periodic messages while unresolved in queue_one mode", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["RUNNING","STOPPED"]',
        initialState: "RUNNING",
        initialContext: '{}',
        intervalEnabled: true,
        intervalMs: 30,
        intervalPolicy: "queue_one",
        intervalMode: "fixed_rate"
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const out = helper.getNode("helper-out");
      let intervalCount = 0;

      out.on("input", function(msg) {
        if (msg.payload.lifecycleType === "active_interval") {
          intervalCount += 1;
        }
      });

      setTimeout(function() {
        try {
          assert.strictEqual(intervalCount, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 180);
    });
  });

  it("dfsm-update-context merges retained context without emitting transition lifecycle", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"keep":1,"nested":{"old":true}}'
      },
      {
        id: "up",
        type: "dfsm-update-context",
        fsm: "cfg",
        mode: "merge",
        wires: [["helper-pass"]]
      },
      {
        id: "out",
        type: "dfsm-active",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-active"]]
      },
      { id: "helper-pass", type: "helper" },
      { id: "helper-active", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const updater = helper.getNode("up");
      const cfg = helper.getNode("cfg");
      const pass = helper.getNode("helper-pass");
      const active = helper.getNode("helper-active");
      let activeCount = 0;

      active.on("input", function() {
        activeCount += 1;
      });

      pass.on("input", function(msg) {
        try {
          assert.strictEqual(msg.traceId, "ctx-1");
          assert.deepStrictEqual(msg.payload, { context: { add: 2, nested: { replaced: true } } });
        } catch (error) {
          done(error);
        }
      });

      updater.receive({
        traceId: "ctx-1",
        payload: {
          context: { add: 2, nested: { replaced: true } }
        }
      });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(cfg.getContext(), { keep: 1, add: 2, nested: { replaced: true } });
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
          assert.strictEqual(cfg.getEventId(), 0);
          assert.strictEqual(activeCount, 0);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-update-context rejects state mismatch and preserves retained context", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"safe":true}'
      },
      {
        id: "up",
        type: "dfsm-update-context",
        fsm: "cfg",
        mode: "merge",
        wires: [["helper-pass"]]
      },
      {
        id: "err",
        type: "dfsm-error",
        fsm: "cfg",
        wires: [["helper-error"]]
      },
      { id: "helper-pass", type: "helper" },
      { id: "helper-error", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const updater = helper.getNode("up");
      const cfg = helper.getNode("cfg");
      const pass = helper.getNode("helper-pass");
      const err = helper.getNode("helper-error");
      let passSeen = false;

      pass.on("input", function() {
        passSeen = true;
      });

      err.on("input", function(msg) {
        setTimeout(function() {
          try {
            assert.strictEqual(msg.payload.type, "state_mismatch");
            assert.strictEqual(msg.payload.currentState, "IDLE");
            assert.strictEqual(msg.payload.requestedState, "RUNNING");
            assert.deepStrictEqual(cfg.getContext(), { safe: true });
            assert.strictEqual(cfg.getCurrentState(), "IDLE");
            assert.strictEqual(cfg.getEventId(), 0);
            assert.strictEqual(passSeen, true);
            done();
          } catch (error) {
            done(error);
          }
        }, 50);
      });

      updater.receive({
        payload: {
          state: "RUNNING",
          context: { safe: false }
        }
      });
    });
  });

  it("dfsm-update-context supports replace mode without transition side effects", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{"one":1,"two":2}'
      },
      {
        id: "up",
        type: "dfsm-update-context",
        fsm: "cfg",
        mode: "replace",
        wires: [["helper-pass"]]
      },
      { id: "helper-pass", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const updater = helper.getNode("up");
      const cfg = helper.getNode("cfg");
      const pass = helper.getNode("helper-pass");

      pass.on("input", function(msg) {
        try {
          assert.strictEqual(msg.note, "replace-check");
        } catch (error) {
          done(error);
        }
      });

      updater.receive({
        note: "replace-check",
        payload: {
          context: { only: true }
        }
      });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(cfg.getContext(), { only: true });
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
          assert.strictEqual(cfg.getEventId(), 0);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-summary emits markdown summary on input", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        name: "FSM1",
        states: '["RESET","READY","RUNNING","CLEANUP"]',
        initialState: "RESET",
        initialContext: '{}',
        allowedTransitions: '[{"from":"RESET","to":"READY"},{"from":"READY","to":"RUNNING"}]'
      },
      {
        id: "summary",
        type: "dfsm-summary",
        fsm: "cfg",
        format: "markdown",
        wires: [["helper-out"]]
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const summary = helper.getNode("summary");
      const out = helper.getNode("helper-out");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(typeof msg.payload, "string");
          assert.ok(msg.payload.includes("# DFSM Summary"));
          assert.ok(msg.payload.includes("- Name: FSM1"));
          assert.ok(msg.payload.includes("- Initial state: RESET"));
          assert.ok(msg.payload.includes("## States"));
          assert.ok(msg.payload.includes("- RESET"));
          assert.ok(msg.payload.includes("## Allowed Transitions"));
          assert.ok(msg.payload.includes("- RESET -> READY"));
          assert.ok(msg.payload.includes("## Interval"));
          assert.ok(msg.payload.includes("- Enabled: false"));
          assert.ok(msg.payload.includes("- Interval ms: 1000"));
          assert.strictEqual(msg.keepMe, "yes");
          done();
        } catch (error) {
          done(error);
        }
      });

      summary.receive({ keepMe: "yes" });
    });
  });

  it("dfsm-summary emits html summary on input when format is html", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        name: "My<Machine>",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}',
        allowedTransitions: '[{"from":"IDLE","to":"RUNNING"}]'
      },
      {
        id: "summary",
        type: "dfsm-summary",
        fsm: "cfg",
        format: "html",
        wires: [["helper-out"]]
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const summary = helper.getNode("summary");
      const out = helper.getNode("helper-out");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(typeof msg.payload, "string");
          assert.ok(msg.payload.includes("<h1>DFSM Summary</h1>"));
          assert.ok(msg.payload.includes("<h2>State Machine</h2>"));
          assert.ok(msg.payload.includes("<h2>States</h2>"));
          assert.ok(msg.payload.includes("<h2>Allowed Transitions</h2>"));
          // machine name should be HTML-escaped
          assert.ok(msg.payload.includes("My&lt;Machine&gt;"));
          assert.ok(!msg.payload.includes("My<Machine>"));
          // states
          assert.ok(msg.payload.includes("<li>IDLE</li>"));
          assert.ok(msg.payload.includes("<li>RUNNING</li>"));
          // transition
          assert.ok(msg.payload.includes("IDLE -&gt; RUNNING"));
          // interval section present (interval always returned by dfsm-state-machine)
          assert.ok(msg.payload.includes("<h2>Interval</h2>"));
          assert.ok(msg.payload.includes("<li><strong>Enabled:</strong> false</li>"));
          // message preserved
          assert.strictEqual(msg.keepMe, "yes");
          done();
        } catch (error) {
          done(error);
        }
      });

      summary.receive({ keepMe: "yes" });
    });
  });

  it("dfsm-trace emits enter-only events when configured", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: true,
        includeExit: false,
        includeActive: false,
        includeError: false,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");
      let count = 0;

      out.on("input", function(msg) {
        count += 1;
        try {
          assert.strictEqual(msg.topic, "state-enter");
          assert.strictEqual(msg.payload.traceType, "state-enter");
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.message, "ENTER state RUNNING");
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          assert.strictEqual(count, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-trace emits exit-only events when configured", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: true,
        includeActive: false,
        includeError: false,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");
      let count = 0;

      out.on("input", function(msg) {
        count += 1;
        try {
          assert.strictEqual(msg.topic, "state-exit");
          assert.strictEqual(msg.payload.traceType, "state-exit");
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.message, "EXIT state IDLE");
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          assert.strictEqual(count, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-trace emits active-only events when configured", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: false,
        includeActive: true,
        includeError: false,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");
      let count = 0;

      out.on("input", function(msg) {
        count += 1;
        try {
          assert.strictEqual(msg.topic, "state-active");
          assert.strictEqual(msg.payload.traceType, "state-active");
          assert.strictEqual(msg.payload.state, "RUNNING");
          assert.strictEqual(msg.payload.prevState, "IDLE");
          assert.strictEqual(msg.payload.changed, true);
          assert.strictEqual(msg.payload.retrigger, false);
          assert.strictEqual(msg.payload.eventId, 1);
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });

      setTimeout(function() {
        try {
          assert.strictEqual(count, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-trace emits error-only events when configured", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: false,
        includeActive: false,
        includeError: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");
      let count = 0;

      out.on("input", function(msg) {
        count += 1;
        try {
          assert.strictEqual(msg.topic, "dfsm-error");
          assert.strictEqual(msg.payload.traceType, "dfsm-error");
          assert.ok(msg.payload.error);
          assert.strictEqual(msg.payload.error.type, "invalid_state");
          assert.strictEqual(msg.payload.message, "ERROR invalid_state");
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "BAD" } });

      setTimeout(function() {
        try {
          assert.strictEqual(count, 1);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-trace supports multiple enabled event types", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: true,
        includeExit: false,
        includeActive: false,
        includeError: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");
      const topics = [];

      out.on("input", function(msg) {
        topics.push(msg.topic);
      });

      input.receive({ payload: { nextState: "RUNNING" } });
      input.receive({ payload: { nextState: "BAD" } });

      setTimeout(function() {
        try {
          assert.strictEqual(topics.includes("state-enter"), true);
          assert.strictEqual(topics.includes("dfsm-error"), true);
          assert.strictEqual(topics.length, 2);
          done();
        } catch (error) {
          done(error);
        }
      }, 120);
    });
  });

  it("dfsm-trace emits a stable normalized payload shape", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: '{}'
      },
      {
        id: "trace",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: false,
        includeActive: true,
        includeError: false,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-activate",
        fsm: "cfg"
      },
      { id: "helper-out", type: "helper" }
    ];

    helper.load(nodes, flow, function() {
      const input = helper.getNode("in");
      const out = helper.getNode("helper-out");

      out.on("input", function(msg) {
        try {
          assert.strictEqual(msg.topic, "state-active");
          assert.strictEqual(typeof msg.payload, "object");
          assert.strictEqual(msg.payload.traceType, "state-active");
          assert.strictEqual(typeof msg.payload.state, "string");
          assert.strictEqual(typeof msg.payload.prevState, "string");
          assert.strictEqual(typeof msg.payload.changed, "boolean");
          assert.strictEqual(typeof msg.payload.retrigger, "boolean");
          assert.strictEqual(typeof msg.payload.timestamp, "number");
          assert.strictEqual(typeof msg.payload.eventId, "number");
          assert.strictEqual(msg.payload.error, null);
          assert.strictEqual(typeof msg.payload.message, "string");
          done();
        } catch (error) {
          done(error);
        }
      });

      input.receive({ payload: { nextState: "RUNNING" } });
    });
  });
});

// =============================================================================
// dfsm-util-latch tests
// =============================================================================

const latchNodes = [dfsmLatchNode];

function buildLatchFlow(overrides) {
  return [
    Object.assign(
      {
        id: "latch",
        type: "dfsm-util-latch",
        bufferMode:  "one",
        queueMode:   "release-all",
        triggerMode: "edge",
        wires: [["helper-out"]]
      },
      overrides
    ),
    { id: "helper-out", type: "helper" }
  ];
}

describe("dfsm-util-latch", function() {
  beforeEach(function(done) {
    helper.startServer(done);
  });

  afterEach(function(done) {
    helper.unload();
    helper.stopServer(done);
  });

  // ---------------------------------------------------------------------------
  // edge + one + release-all  (defaults)
  // ---------------------------------------------------------------------------

  it("edge+one: replaces stored message and releases on trigger", function(done) {
    const flow = buildLatchFlow({});

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const received = [];

      out.on("input", function(msg) {
        received.push(msg);
      });

      latch.receive({ payload: "first" });
      latch.receive({ payload: "second" });   // replaces "first"

      // Trigger: both messages queued were replaced, so only "second" is released.
      latch.receive({ topic: "trigger", payload: "go" });

      setTimeout(function() {
        try {
          assert.strictEqual(received.length, 1);
          assert.strictEqual(received[0].payload, "second");
          assert.strictEqual(received[0].trigger, "go");
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // edge + all + release-all  (FIFO, all released)
  // ---------------------------------------------------------------------------

  it("edge+all+release-all: queues all messages and releases in FIFO order", function(done) {
    const flow = buildLatchFlow({ bufferMode: "all" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const payloads = [];

      out.on("input", function(msg) { payloads.push(msg.payload); });

      latch.receive({ payload: "a" });
      latch.receive({ payload: "b" });
      latch.receive({ payload: "c" });

      latch.receive({ topic: "trigger", payload: true });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(payloads, ["a", "b", "c"]);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // edge + all + release-one  (FIFO, one at a time)
  // ---------------------------------------------------------------------------

  it("edge+all+release-one: releases only the oldest message per trigger (FIFO)", function(done) {
    const flow = buildLatchFlow({ bufferMode: "all", queueMode: "release-one" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const payloads = [];

      out.on("input", function(msg) { payloads.push(msg.payload); });

      latch.receive({ payload: 1 });
      latch.receive({ payload: 2 });
      latch.receive({ payload: 3 });

      // First trigger: releases oldest (1).
      latch.receive({ topic: "trigger", payload: "t1" });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(payloads, [1]);

          // Second trigger: releases next oldest (2).
          latch.receive({ topic: "trigger", payload: "t2" });

          setTimeout(function() {
            try {
              assert.deepStrictEqual(payloads, [1, 2]);
              done();
            } catch (e) { done(e); }
          }, 80);
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // edge: trigger on empty queue produces no output
  // ---------------------------------------------------------------------------

  it("edge: trigger on empty queue produces no output", function(done) {
    const flow = buildLatchFlow({});

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      let triggered = false;

      out.on("input", function() { triggered = true; });

      latch.receive({ topic: "trigger", payload: true });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // clear: discards all queued messages without output
  // ---------------------------------------------------------------------------

  it("clear: discards queued messages without emitting any output", function(done) {
    const flow = buildLatchFlow({ bufferMode: "all" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      let triggered = false;

      out.on("input", function() { triggered = true; });

      latch.receive({ payload: "keep-me-not" });
      latch.receive({ payload: "nor-me" });
      latch.receive({ topic: "clear" });

      // Trigger after clear — queue should be empty, so nothing emitted.
      latch.receive({ topic: "trigger", payload: true });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // gate: open gate passes messages through immediately
  // ---------------------------------------------------------------------------

  it("gate: messages pass through immediately when gate is open", function(done) {
    const flow = buildLatchFlow({ triggerMode: "gate" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const payloads = [];

      out.on("input", function(msg) { payloads.push(msg.payload); });

      // Open the gate.
      latch.receive({ topic: "trigger", payload: true });

      // These should pass through immediately.
      latch.receive({ payload: "x" });
      latch.receive({ payload: "y" });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(payloads, ["x", "y"]);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // gate: closed gate discards messages
  // ---------------------------------------------------------------------------

  it("gate: messages are discarded when gate is closed", function(done) {
    const flow = buildLatchFlow({ triggerMode: "gate" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      let triggered = false;

      out.on("input", function() { triggered = true; });

      // Gate starts closed — send messages without opening.
      latch.receive({ payload: "ignored-1" });
      latch.receive({ payload: "ignored-2" });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // gate: close gate after opening stops pass-through
  // ---------------------------------------------------------------------------

  it("gate: closing gate stops pass-through", function(done) {
    const flow = buildLatchFlow({ triggerMode: "gate" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const payloads = [];

      out.on("input", function(msg) { payloads.push(msg.payload); });

      // Open, send one, close, send another.
      latch.receive({ topic: "trigger", payload: 1 });
      latch.receive({ payload: "passes" });
      latch.receive({ topic: "trigger", payload: 0 });
      latch.receive({ payload: "discarded" });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(payloads, ["passes"]);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // gate: does not queue messages (clear is a no-op in terms of queued state)
  // ---------------------------------------------------------------------------

  it("gate: clear does not cause any output", function(done) {
    const flow = buildLatchFlow({ triggerMode: "gate" });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      let triggered = false;

      out.on("input", function() { triggered = true; });

      latch.receive({ topic: "trigger", payload: true });
      latch.receive({ topic: "clear" });
      latch.receive({ topic: "trigger", payload: true });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // message cloning: upstream mutation does not corrupt queued messages
  // ---------------------------------------------------------------------------

  it("edge: stored messages are cloned so upstream mutation does not affect them", function(done) {
    const flow = buildLatchFlow({});

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      let received = null;

      out.on("input", function(msg) { received = msg; });

      const original = { payload: { value: 42 } };
      latch.receive(original);

      // Mutate original after sending.
      original.payload.value = 999;

      latch.receive({ topic: "trigger", payload: true });

      setTimeout(function() {
        try {
          assert.ok(received, "expected a message to be received");
          assert.strictEqual(received.payload.value, 42);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });

  // ---------------------------------------------------------------------------
  // invalid config defaults: node falls back gracefully
  // ---------------------------------------------------------------------------

  it("falls back to safe defaults for unrecognised config values", function(done) {
    const flow = buildLatchFlow({
      bufferMode:  "nonsense",
      queueMode:   "nonsense",
      triggerMode: "nonsense"
    });

    helper.load(latchNodes, flow, function() {
      const latch = helper.getNode("latch");
      const out   = helper.getNode("helper-out");
      const payloads = [];

      out.on("input", function(msg) { payloads.push(msg.payload); });

      // With defaults (edge + one + release-all):
      latch.receive({ payload: "only" });
      latch.receive({ topic: "trigger", payload: "go" });

      setTimeout(function() {
        try {
          assert.deepStrictEqual(payloads, ["only"]);
          done();
        } catch (e) { done(e); }
      }, 80);
    });
  });
});

// =============================================================================
// dfsm-complete-activation tests
// =============================================================================
describe("dfsm-complete-activation node", function() {
  beforeEach(function(done) {
    helper.startServer(done);
  });
  afterEach(function(done) {
    helper.unload();
    helper.stopServer(done);
  });
  const caNodes = [
    dfsmConfigNode,
    dfsmInNode,
    dfsmOutNode,
    dfsmErrorNode,
    dfsmTraceNode,
    dfsmCompleteActivationNode
  ];
  function buildCaFlow(extra) {
    return [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        name: "machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: "{}"
      },
      ...extra
    ];
  }
  it("resolves in-flight activation without changing state", function(done) {
    const flow = buildCaFlow([
      { id: "completer", type: "dfsm-complete-activation", fsm: "cfg", wires: [] }
    ]);
    helper.load(caNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const completer = helper.getNode("completer");
      cfg.next({ nextState: "IDLE" }, {});
      const stateBefore = cfg.getCurrentState();
      completer.receive({ payload: {} });
      const stateAfter = cfg.getCurrentState();
      try {
        assert.strictEqual(stateBefore, "IDLE");
        assert.strictEqual(stateAfter, "IDLE", "state must not change");
        done();
      } catch (e) { done(e); }
    });
  });
  it("does not fabricate a state change or active event", function(done) {
    const flow = buildCaFlow([
      { id: "completer", type: "dfsm-complete-activation", fsm: "cfg", wires: [] },
      { id: "active-out", type: "dfsm-active", fsm: "cfg", emitAll: true, wires: [["helper-active"]] },
      { id: "helper-active", type: "helper" }
    ]);
    helper.load(caNodes, flow, function() {
      const completer = helper.getNode("completer");
      const helperActive = helper.getNode("helper-active");
      const events = [];
      helperActive.on("input", function(msg) { events.push(msg.payload); });
      completer.receive({ payload: {} });
      setTimeout(function() {
        try {
          assert.strictEqual(events.length, 0, "completeLifecycleStep must not emit active events");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });
  it("emits activation-complete trace when includeCompletion is true", function(done) {
    const flow = buildCaFlow([
      { id: "completer", type: "dfsm-complete-activation", fsm: "cfg", wires: [] },
      {
        id: "tracer",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: false,
        includeActive: false,
        includeError: false,
        includeCompletion: true,
        wires: [["helper-trace"]]
      },
      { id: "helper-trace", type: "helper" }
    ]);
    helper.load(caNodes, flow, function() {
      const completer = helper.getNode("completer");
      const helperTrace = helper.getNode("helper-trace");
      let traceMsg = null;
      helperTrace.on("input", function(msg) { traceMsg = msg; });
      completer.receive({ payload: {} });
      setTimeout(function() {
        try {
          assert.ok(traceMsg, "expected a trace message");
          assert.strictEqual(traceMsg.payload.traceType, "activation-complete");
          assert.strictEqual(traceMsg.payload.changed, false);
          assert.strictEqual(traceMsg.payload.retrigger, false);
          assert.strictEqual(traceMsg.payload.state, "IDLE");
          assert.ok(traceMsg.payload.message, "trace must include a human-readable message");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });
  it("does not emit trace when includeCompletion is false", function(done) {
    const flow = buildCaFlow([
      { id: "completer", type: "dfsm-complete-activation", fsm: "cfg", wires: [] },
      {
        id: "tracer",
        type: "dfsm-trace",
        fsm: "cfg",
        includeEnter: false,
        includeExit: false,
        includeActive: false,
        includeError: false,
        includeCompletion: false,
        wires: [["helper-trace"]]
      },
      { id: "helper-trace", type: "helper" }
    ]);
    helper.load(caNodes, flow, function() {
      const completer = helper.getNode("completer");
      const helperTrace = helper.getNode("helper-trace");
      let traceMsg = null;
      helperTrace.on("input", function(msg) { traceMsg = msg; });
      completer.receive({ payload: {} });
      setTimeout(function() {
        try {
          assert.strictEqual(traceMsg, null, "no trace should be emitted when includeCompletion is false");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });
  it("is a terminal node and does not forward messages", function(done) {
    const flow = buildCaFlow([
      { id: "completer", type: "dfsm-complete-activation", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(caNodes, flow, function() {
      const completer = helper.getNode("completer");
      const helperOut = helper.getNode("helper-out");
      let received = false;
      helperOut.on("input", function() { received = true; });
      completer.receive({ payload: {} });
      setTimeout(function() {
        try {
          assert.strictEqual(received, false, "dfsm-complete-activation must not forward messages");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });
  it("dfsm-activate same-state behavior is unchanged (backward compat)", function(done) {
    const flow = buildCaFlow([
      { id: "in", type: "dfsm-activate", fsm: "cfg", retrigger: false, defaultState: "", wires: [] },
      { id: "active-out", type: "dfsm-active", fsm: "cfg", emitAll: true, wires: [["helper-active"]] },
      { id: "helper-active", type: "helper" }
    ]);
    helper.load(caNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const inNode = helper.getNode("in");
      const helperActive = helper.getNode("helper-active");
      cfg.next({ nextState: "RUNNING" }, {});
      const events = [];
      helperActive.on("input", function(msg) { events.push(msg.payload); });
      inNode.receive({ payload: { nextState: "RUNNING" } });
      setTimeout(function() {
        try {
          assert.strictEqual(cfg.getCurrentState(), "RUNNING");
          assert.strictEqual(events.length, 0, "same-state completion via dfsm-activate should not produce active event");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });
});

// =============================================================================
// dfsm-attach-snapshot tests
// =============================================================================
describe("dfsm-attach-snapshot node", function() {
  beforeEach(function(done) {
    helper.startServer(done);
  });
  afterEach(function(done) {
    helper.unload();
    helper.stopServer(done);
  });

  const asNodes = [
    dfsmConfigNode,
    dfsmInNode,
    dfsmOutNode,
    dfsmErrorNode,
    dfsmTraceNode,
    dfsmAttachSnapshotNode
  ];

  function buildAsFlow(extra) {
    return [
      {
        id: "cfg",
        type: "dfsm-state-machine",
        name: "machine",
        states: '["IDLE","RUNNING"]',
        initialState: "IDLE",
        initialContext: "{}"
      },
      ...extra
    ];
  }

  it("attaches snapshot to a message with no dfsm fields", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      let received = null;
      helperOut.on("input", function(msg) { received = msg; });

      // Transition to RUNNING
      cfg.next({ nextState: "RUNNING" }, {});

      // Send a message with no dfsm fields
      snap.receive({ payload: { data: "test" } });

      setTimeout(function() {
        try {
          assert.ok(received, "message should be received");
          assert.strictEqual(received.payload.data, "test", "payload should be preserved");
          assert.strictEqual(received.state, "RUNNING", "state should be attached");
          assert.strictEqual(received.prevState, "IDLE", "prevState should be attached");
          assert.ok(received.context !== undefined, "context should be attached");
          assert.strictEqual(received.eventId, 1, "eventId should be attached");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("overwrites stale dfsm fields with current runtime snapshot", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      let received = null;
      helperOut.on("input", function(msg) { received = msg; });

      // Transition to RUNNING
      cfg.next({ nextState: "RUNNING" }, {});

      // Send a message with stale dfsm fields
      snap.receive({
        payload: { data: "test" },
        state: "STALE",
        prevState: "OLD",
        context: { old: true }
      });

      setTimeout(function() {
        try {
          assert.strictEqual(received.state, "RUNNING", "state should be overwritten with current");
          assert.strictEqual(received.prevState, "IDLE", "prevState should be overwritten with current");
          assert.strictEqual(received.context.old, undefined, "context should be replaced with current");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("preserves unrelated message properties", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      let received = null;
      helperOut.on("input", function(msg) { received = msg; });

      cfg.next({ nextState: "RUNNING" }, {});

      snap.receive({
        payload: { data: "test" },
        topic: "my-topic",
        _msgid: "original-id",
        custom: "field"
      });

      setTimeout(function() {
        try {
          assert.strictEqual(received.topic, "my-topic", "topic should be preserved");
          assert.strictEqual(received._msgid, "original-id", "_msgid should be preserved");
          assert.strictEqual(received.custom, "field", "custom fields should be preserved");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("attaches current retained context correctly", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      let received = null;
      helperOut.on("input", function(msg) { received = msg; });

      // Transition with context
      cfg.next({ nextState: "RUNNING", context: { counter: 42, name: "test" } }, {});

      snap.receive({ payload: {} });

      setTimeout(function() {
        try {
          assert.ok(received.context !== undefined, "context should be attached");
          assert.strictEqual(received.context.counter, 42, "context.counter should match");
          assert.strictEqual(received.context.name, "test", "context.name should match");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("does not trigger a transition", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      helperOut.on("input", function() {});

      const stateBefore = cfg.getCurrentState();
      snap.receive({ payload: {} });
      const stateAfter = cfg.getCurrentState();

      setTimeout(function() {
        try {
          assert.strictEqual(stateBefore, "IDLE", "state should be IDLE initially");
          assert.strictEqual(stateAfter, "IDLE", "state should not change after attach-snapshot");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("reports current state correctly when state hasn't changed", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      let received = null;
      helperOut.on("input", function(msg) { received = msg; });

      // No transition, still in IDLE
      snap.receive({ payload: {} });

      setTimeout(function() {
        try {
          assert.strictEqual(received.state, "IDLE", "state should be IDLE");
          assert.strictEqual(received.prevState, null, "prevState should be null (no transition yet)");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("emits no dfsm-error on valid message", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "error", type: "dfsm-error", fsm: "cfg", wires: [["helper-error"]] },
      { id: "helper-out", type: "helper" },
      { id: "helper-error", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const snap = helper.getNode("snap");
      const helperError = helper.getNode("helper-error");
      let errorReceived = false;
      helperError.on("input", function() { errorReceived = true; });

      snap.receive({ payload: { data: "test" } });

      setTimeout(function() {
        try {
          assert.strictEqual(errorReceived, false, "no error should be emitted");
          done();
        } catch (e) { done(e); }
      }, 50);
    });
  });

  it("works correctly after multiple state changes", function(done) {
    const flow = buildAsFlow([
      { id: "snap", type: "dfsm-attach-snapshot", fsm: "cfg", wires: [["helper-out"]] },
      { id: "helper-out", type: "helper" }
    ]);
    helper.load(asNodes, flow, function() {
      const cfg = helper.getNode("cfg");
      const snap = helper.getNode("snap");
      const helperOut = helper.getNode("helper-out");
      const received = [];
      helperOut.on("input", function(msg) { received.push(msg); });

      // Multiple transitions
      cfg.next({ nextState: "RUNNING" }, {});
      snap.receive({ payload: { order: 1 } });

      cfg.next({ nextState: "IDLE" }, {});
      snap.receive({ payload: { order: 2 } });

      setTimeout(function() {
        try {
          assert.strictEqual(received.length, 2, "two messages should be received");
          assert.strictEqual(received[0].state, "RUNNING", "first snapshot should be RUNNING");
          assert.strictEqual(received[0].prevState, "IDLE", "first prevState should be IDLE");
          assert.strictEqual(received[1].state, "IDLE", "second snapshot should be IDLE");
          assert.strictEqual(received[1].prevState, "RUNNING", "second prevState should be RUNNING");
          done();
        } catch (e) { done(e); }
      }, 100);
    });
  });
});

