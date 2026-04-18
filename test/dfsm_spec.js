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

const dfsmConfigNode  = require("../src/dfsm-config.js");
const dfsmInNode      = require("../src/dfsm-in.js");
const dfsmOutNode     = require("../src/dfsm-out.js");
const dfsmErrorNode   = require("../src/dfsm-error.js");
const dfsmLatchNode   = require("../src/dfsm-util-latch.js");
const dfsmStateEnterNode = require("../src/dfsm-state-enter.js");
const dfsmStateExitNode = require("../src/dfsm-state-exit.js");

initializeHelperRuntime(helper);

const nodes = [
  dfsmConfigNode,
  dfsmInNode,
  dfsmOutNode,
  dfsmErrorNode,
  dfsmLatchNode,
  dfsmStateEnterNode,
  dfsmStateExitNode
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
      type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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

  it("suppresses same-state requests when retrigger is disabled", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-config",
        states: '["IDLE","RUNNING"]',
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

      input.receive({ payload: { nextState: "IDLE" } });

      setTimeout(function() {
        try {
          assert.strictEqual(triggered, false);
          assert.strictEqual(cfg.getEventId(), 0);
          assert.strictEqual(cfg.getCurrentState(), "IDLE");
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
        states: '["IDLE","STARTING","RUNNING","FAULT"]',
        initialState: "IDLE",
        initialContext: '{}',
        allowedTransitions: '[{"from":"IDLE","to":"STARTING"},{"from":"STARTING","to":"RUNNING"},{"from":"*","to":"FAULT"}]'
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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

  it("emits periodic active lifecycle messages from dfsm-config when interval is enabled", function(done) {
    const flow = [
      {
        id: "cfg",
        type: "dfsm-config",
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
        type: "dfsm-config",
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
        type: "dfsm-config",
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


