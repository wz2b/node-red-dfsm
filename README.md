# @wz2b/node-red-dfsm

A Node-RED finite-state-machine library inspired by readability, but documented primarily in its own
runtime terms.

`@wz2b/node-red-dfsm` is a library for building first-class finite state machines in Node-RED.
It draws on ideas from several domains, including IEC 61131 SFC and the classic
3-process VHDL FSM architecture used in FPGA development, where explicit state
structure and separation of concerns are critical for readability and correctness.

This library borrows structural ideas from established state-machine design patterns to improve
the readability of Node-RED state machines.

## ⚠️ Important: Not a PLC Replacement

This library is **not** intended to replace a real PLC or certified control system.

While it borrows concepts from PLC programming (such as SFC-style state machines), it runs on Node-RED and a
general-purpose runtime. As such, it does **not** provide the guarantees typically expected from PLC environments,
including:

- deterministic execution timing
- real-time scheduling
- fault tolerance and recovery behavior
- safety certification or validation

Accordingly, this software is **not recommended** for use in **safety-critical or life-safety applications**,
motion control, or any system where failure could result in injury, damage, or regulatory non-compliance.

Platforms such as WAGO controllers and similar edge devices often include dedicated PLC runtimes (for example,
CODESYS) specifically to provide the execution model expected for industrial control. IEC 61131 environments and
languages such as Ladder Logic, Structured Text, and Sequential Function Chart exist for good reason: they are
designed around predictable scan-based execution, well-defined task models, and runtime behavior that is generally
far more suitable for control applications than a general-purpose event-driven environment.

When you use those languages on the associated hardware, you are not just getting different programming syntax.
You are also getting an execution environment designed for industrial control, including more predictable timing,
clearer tasking and concurrency behavior, and a more mature foundation for reliability and recovery.

Node-RED is not that environment. This library borrows useful control-structure ideas from PLC programming, but
it does not provide PLC-class determinism, safety, or runtime guarantees.

## ⚠️ Usage Responsibility and Liability

The appropriateness of this library for any given application is solely the responsibility of the implementor.

This software is provided **"as is"**, without warranties of any kind, express or implied, including but not
limited to warranties of performance, merchantability, fitness for a particular purpose, or non-infringement.

The authors do **not** endorse its use in any specific application domain and assume **no liability** for any
damages, failures, losses, or other consequences resulting from its use.

Use in safety-critical, life-safety, motion control, or regulated systems should be carefully evaluated by
qualified professionals, and appropriate certified control systems should be used where required.

This library is intended for:

- non-critical automation
- prototyping and experimentation
- visualization and orchestration logic
- lab, test, and educational use

Use appropriate, certified control systems for any application requiring reliability, determinism, or safety
guarantees.


## Why this project exists

I wrote this library because Node-RED state machines can become unreadable surprisingly quickly.

For small flows, it is easy enough to keep state in a function node, use a few link nodes, and rely on local
conventions. But as the flow grows, the control logic often gets scattered across context variables, function nodes,
and implicit message patterns. At that point, it becomes harder to see the machine structure, harder to reason about
transitions, and harder to understand what happens on entry, while active, and on exit.

That readability problem was the real starting point for this project.

In looking for a better approach, I drew on several influences from my background in software, hardware, and
controls, including IEC 61131 SFC, classic 3-process VHDL FSM design, and the use of explicit state machines for
cooperative multitasking on lightweight embedded systems.

The result is a library designed to make finite-state machine behavior visible and explicit in the flow:

- state is held centrally in the FSM rather than scattered across Node-RED flow or global context
- state actions are triggered explicitly
- next-state decisions are made explicitly visible in the flow
- error handling is explicit too
- the design favors visible flow structure over hidden magic

To do that, the library separates state machine responsibilities into dedicated nodes:

1. a state-machine node owns the runtime machine state and shared context
2. an activation node applies explicit transition requests
3. an active-state node emits explicit state-trigger events to handler flows
4. an error node emits rejected transitions and other FSM issues explicitly

This mirrors a familiar FSM split:

- runtime state register = `dfsm-state-machine`  
  (held in memory only; not persisted to disk and reset on restart/redeploy unless you add your own persistence)
- next-state logic = ordinary Node-RED flow logic you build yourself
- state action logic = handler flows driven by `dfsm-active`

## Shared context model

Each FSM instance retains a **single shared context object**.

- The context is not scoped per state.
- Any state handler may read or update any part of that shared context.
- Context updates are shallow only.
- Arrays and nested objects are replaced as normal property values.
- Use `replaceContext: true` when you want to replace the full retained context.

Because the context is shared across the whole machine, users are encouraged to organize it carefully, for example
by grouping related fields into nested objects:

```json
{
  "control": {
	"setpoint": 1.2,
	"enabled": true
  },
  "metrics": {
	"restarts": 3
  }
}
```

## Nodes

Full per-node documentation is in [`NODES.md`](./NODES.md).

- [`dfsm-state-machine`](./NODES.md#dfsm-state-machine) - Central state holder and lifecycle coordinator for each FSM instance.
- [`dfsm-activate`](./NODES.md#dfsm-activate) - Requests state activations/transitions and applies optional context updates.
- [`dfsm-update-context`](./NODES.md#dfsm-update-context) - Updates retained FSM context without requesting a transition.
- [`dfsm-active`](./NODES.md#dfsm-active) - Emits active-lifecycle snapshots for state handler flows.
- [`dfsm-state-enter`](./NODES.md#dfsm-state-enter) - Emits when a configured state is entered.
- [`dfsm-state-exit`](./NODES.md#dfsm-state-exit) - Emits when a configured state is exited.
- [`dfsm-error`](./NODES.md#dfsm-error) - Emits structured FSM errors and rejected transition details.
- [`dfsm-summary`](./NODES.md#dfsm-summary) - Generates Markdown/HTML state-machine summaries.
- [`dfsm-trace`](./NODES.md#dfsm-trace) - Emits normalized trace events across selected FSM channels.
- [`dfsm-attach-snapshot`](./NODES.md#dfsm-attach-snapshot) - Reattaches current retained FSM snapshot fields to any incoming message.
- [`dfsm-util-latch`](./NODES.md#dfsm-util-latch) - Utility latch for queuing, gating, batching, and releasing messages.

## Message contracts

### Canonical DFSM namespace

DFSM-owned runtime metadata now lives under `msg.dfsm` so `msg.payload` remains available for ordinary application/work data.

Canonical DFSM metadata fields include:

- `msg.dfsm.state`
- `msg.dfsm.prevState`
- `msg.dfsm.context`
- `msg.dfsm.changed`
- `msg.dfsm.retrigger`
- `msg.dfsm.eventId`
- `msg.dfsm.timestamp`

Additional DFSM-owned structures also live under `msg.dfsm`, for example:

- `msg.dfsm.error`
- `msg.dfsm.trace`

### Accepted transition request into `dfsm-activate`

```json
{
  "dfsm": {
    "nextState": "RUNNING",
    "context": {
      "control": {
        "setpoint": 1.2
      }
    }
  }
}
```

### Same-state retrigger example

An FSM handler may receive:

```json
{
  "dfsm": {
    "state": "RUNNING",
    "prevState": "RUNNING",
    "changed": false,
    "retrigger": true,
    "context": {
	  "setpoint": 1.1
    }
  }
}
```

That handler can then explicitly request either another same-state loop:

```json
{
  "dfsm": {
    "nextState": "RUNNING",
    "context": {
	  "setpoint": 1.2
    }
  }
}
```

or an advance to another state:

```json
{
  "dfsm": {
    "nextState": "FINISHING"
  }
}
```

### Migration guidance

Before:

- DFSM metadata lived in `msg.payload` or top-level fields
- application/work payload and FSM metadata could collide
- asynchronous or third-party nodes often forced fragile reshaping

After:

- DFSM metadata is emitted canonically under `msg.dfsm`
- `msg.payload` remains available for ordinary application/work data
- async/third-party nodes can replace `msg.payload` without destroying retained FSM metadata

Compatibility strategy:

- runtime output is standardized on `msg.dfsm`
- ingress nodes still accept legacy transition/context input shapes during migration:
  - `msg.payload.nextState`
  - `msg.payload.context`
  - `msg.payload.state`
  - `msg.nextState`
  - `msg.context`
  - `msg.state`
- canonical precedence is always `msg.dfsm` first
- legacy shapes are accepted for compatibility but are no longer emitted by DFSM nodes

## Usage guidelines

- Keep retained machine state in `dfsm-state-machine`, not in scattered ad hoc node context.
- Use `dfsm-update-context` when you only need to mutate retained context without causing transitions.
- Use `dfsm-active` to drive visible per-state handler flows.
- Keep next-state decisions in ordinary flow logic so the control path stays readable.
- Keep error paths wired explicitly with `dfsm-error`.
- Avoid hidden automatic transitions; the only first-pass shortcut is the optional default state on `dfsm-activate`.
- Invalid states are never auto-created.

## Simple example

One simple pattern is:

1. `dfsm-state-machine` defines states `RUNNING`, `STOPPING`, `STOPPED`
2. `dfsm-active` is filtered to `RUNNING`
3. a function node decides the next state based on the current context
4. `dfsm-activate` applies that request
5. `dfsm-error` catches invalid or malformed requests

Conceptually:

```text
dfsm-state-machine ─┬─> dfsm-active (RUNNING) ─> function: decide next state ─> dfsm-activate
			 └─> dfsm-error ─> debug/log/alarm path
```

Example decision function output:

```javascript
if (msg.dfsm.context.control.setpoint > 10) {
  msg.dfsm = { nextState: "STOPPING" };
} else {
  msg.dfsm = {
    nextState: "RUNNING",
    context: {
      control: {
        setpoint: msg.dfsm.context.control.setpoint + 1
      }
    }
  };
}
return msg;
```


## Best Practices

### Per-State Context
If you need state-specific retained data, keep it inside the shared FSM context using your own nested structure,
for example a map keyed by state name:

```json
{
  "byState": {
    "RUNNING": {
      "setpoint": 1.2,
      "step": 4
    },
    "STOPPING": {
      "reason": "operator request"
    }
  }
}
```

### Retriggering

`dfsm-activate` can be configured to allow immediate retrigger behavior for same-state requests.

- When **Retrigger on same state** is disabled, a same-state request marks the current activation complete in place and does not immediately emit a new `dfsm-active` event.
- When **Retrigger on same state** is enabled, a same-state request is emitted as an explicit immediate retrigger event (`msg.dfsm.retrigger = true`).

Immediate same-state retrigger can create tight loops and is usually not desired when interval firing/scanning is used.

Same-state retriggers are transition events only. They do not emit `dfsm-state-enter`/`dfsm-state-exit`, and they do not resolve
the active-cycle state used by config-owned interval scheduling.

If a particular `dfsm-active` handler should ignore same-state retriggers, add a simple filter or switch node that blocks
messages where `msg.dfsm.retrigger` is `true`, or only allows messages where `msg.dfsm.changed` is `true`.

## Breaking rename note

This package now uses `dfsm-activate` and `dfsm-active` instead of `dfsm-in` and `dfsm-out`.

Existing flows and example JSON that still reference the old node types must be updated before import or deploy:

- `dfsm-in` → `dfsm-activate`
- `dfsm-out` → `dfsm-active`



## Design philosophy summary

This library intentionally favors explicit structure over automation:

- retained state is centralized
- state-trigger events are explicit
- next-state logic is visible in the flow
- errors are explicit and wireable
- the shared context model is simple and predictable

It is a first working pass designed to be readable and easy to extend, not a final or fully feature-complete architecture.

## Install

```bash
npm install @wz2b/node-red-dfsm
```

Then restart Node-RED and add the nodes from the editor.

## Development

```bash
yarn install
yarn test
```

Tests use `mocha` and `node-red-node-test-helper`.
