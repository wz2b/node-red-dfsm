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

const dfsmConfigNode = require("../src/dfsm-config.js");
const dfsmInNode = require("../src/dfsm-in.js");
const dfsmOutNode = require("../src/dfsm-out.js");
const dfsmErrorNode = require("../src/dfsm-error.js");

initializeHelperRuntime(helper);

const nodes = [dfsmConfigNode, dfsmInNode, dfsmOutNode, dfsmErrorNode];

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
        type: "dfsm-out",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-in",
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
          state: "RUNNING",
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
        type: "dfsm-out",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-in",
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
          state: "RUNNING",
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
        type: "dfsm-out",
        fsm: "cfg",
        emitAll: true,
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-in",
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

      input.receive({ payload: { state: "IDLE" } });

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
        type: "dfsm-in",
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

      input.receive({ payload: { state: "SANDWICH" } });
    });
  });

  it("uses the default next state when payload.state is missing", function(done) {
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
        type: "dfsm-out",
        fsm: "cfg",
        emitAll: false,
        filterState: "RUNNING",
        wires: [["helper-out"]]
      },
      {
        id: "in",
        type: "dfsm-in",
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
        type: "dfsm-in",
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

      input.receive({ payload: { state: "RUNNING", context: [] } });
    });
  });
});

