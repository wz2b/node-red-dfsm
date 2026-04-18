# @wz2b/node-red-dfsm

`@wz2b/node-red-dfsm` is a first-pass Node-RED library for building explicit finite state machines with separate nodes, inspired by a classic 3-process VHDL FSM architecture.

The goal is not to hide control behavior inside ad hoc context variables, large function nodes, or implicit conventions. Instead, the library makes the machine structure visible in the flow:

- state is retained centrally
- state actions are triggered explicitly
- next-state decisions are made explicitly in the flow
- error handling is explicit too
- the design favors visible flow structure over hidden magic

## Why this exists

In many Node-RED flows, state machine logic ends up spread across function nodes, local variables, and implicit message conventions. That works for small cases, but it can become hard to read, reason about, and maintain.

This package aims to make FSM behavior obvious by separating the responsibilities into dedicated nodes:

1. a config node retains the machine state and shared context
2. an input node applies explicit transition requests
3. an output node emits explicit state-trigger events to handler flows
4. an error node emits rejected transitions and other FSM issues explicitly

This mirrors a familiar FSM split:

- retained state register = `dfsm-config`
- next-state logic = ordinary Node-RED flow logic you build yourself
- state action logic = handler flows driven by `dfsm-out`

## Shared context model

Each FSM instance retains a **single shared context object**.

- The context is not scoped per state.
- Any state handler may read or update any part of that shared context.
- Context updates are shallow only.
- Arrays and nested objects are replaced as normal property values.
- Use `replaceContext: true` when you want to replace the full retained context.

Because the context is shared across the whole machine, users are encouraged to organize it carefully, for example by grouping related fields into nested objects:

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
## Node set

The library adds a new Node-RED section named **state machine** containing:

- `dfsm-in`
- `dfsm-out`
- `dfsm-error`
- `dfsm-state-enter`
- `dfsm-state-exit`
- `dfsm-util-latch`

and one supporting config node:

- `dfsm-config`

## Nodes

### `dfsm-config`

Defines an FSM instance and owns the retained machine data.

#### What it retains

- `currentState`
- `previousState`
- shared `context` object
- allowed state list
- initial state
- initial context clone
- monotonically increasing `eventId`

#### Configuration

- **Name**: optional label for the FSM instance
- **Allowed states**: ordered editable list, one state name per entry
- **Initial state**: dropdown populated from the allowed-state list
- **Initial context**: optional JSON object
- **Allowed transitions**: optional editable list of legal `from -> to` transition rules

#### Runtime behavior

On startup the FSM initializes to:

- `currentState = initialState`
- `previousState = null`
- `context = clone(initialContext || {})`
- `eventId = 0`

The config node accepts normalized transition requests from `dfsm-in`.

Allowed transitions are optional:

- if no transition rules are configured, all valid state-to-state requests are allowed
- if transition rules are configured, only listed transitions are legal
- use `*` as the `from` state to allow a transition from any current state, for example `* -> FAULT`
- use `*` as the `to` state to allow a transition to any valid target state, for example `STARTING -> *`

Transition legality is enforced centrally in the FSM config runtime before any state, context, or event counter is mutated.

When a request is accepted, it computes and publishes a normalized event:

```json
{
  "state": "RUNNING",
  "prevState": "IDLE",
  "changed": true,
  "retrigger": false,
  "context": {
	"setpoint": 1.1
  },
  "eventId": 1,
  "timestamp": 1713260000000
}
```

When a request is rejected, the FSM state and retained context remain unchanged and a structured error event is published for `dfsm-error` subscribers.

Example global transition table:

```json
[
  { "from": "IDLE", "to": "STARTING" },
  { "from": "STARTING", "to": "RUNNING" },
  { "from": "STARTING", "to": "*" },
  { "from": "RUNNING", "to": "STOPPING" },
  { "from": "STOPPING", "to": "IDLE" },
  { "from": "*", "to": "FAULT" }
]
```

### `dfsm-in`

Accepts a next-state request and optional context update, then applies that request through the configured FSM instance.

#### Configuration

- **FSM**: reference to a `dfsm-config` node
- **Allow retrigger**: enabled by default; permits same-state requests to emit explicit retrigger events
- **Default state**: optional fallback next state when no requested next state is provided

#### Input contract

Reads from `msg.payload`:

```json
{
  "nextState": "RUNNING",
  "context": {
	"setpoint": 1.2
  },
  "replaceContext": false
}
```

#### Input semantics

- preferred transition request field is `payload.nextState`
- optional alias `msg.nextState` is also accepted
- if none of `payload.nextState`, `msg.nextState`, or configured `defaultState` is available, the request is rejected
- the older local `dfsm-in` present-state filter is currently disabled and ignored
- the FSM config node applies its optional global allowed-transition rules
- if the FSM config node rejects the requested `current state -> target state` pair as illegal, `dfsm-in` warns and shows red `illegal transition` status
- `payload.context` shallow-merges into the retained FSM context
- if `payload.replaceContext` is `true`, `payload.context` replaces the full retained FSM context
- if the requested state matches the current state:
  - it becomes a retrigger when retrigger is enabled
  - it is suppressed when retrigger is disabled

The FSM config node's allowed-transition table is the global machine rule. `dfsm-in` currently applies transition checks in this order:

1. FSM config global allowed-transition check
2. transition application and event dispatch

State-variable meanings are:

- `prevState` = previous state
- `state` = current state
- `nextState` = requested next state

For example, `dfsm-out` may emit:

```json
{ "prevState": "STARTING", "state": "RUNNING" }
```

A later request into `dfsm-in` should use:

```json
{ "nextState": "STOPPING" }
```

`dfsm-in` does not treat a prior snapshot `payload.state` value as a transition request.

When no custom name is set, `dfsm-in` displays its configured `defaultState` as its node label.

#### Output behavior

`dfsm-in` does not emit a normal output message itself.

- accepted requests cause `dfsm-config` to publish events consumed by `dfsm-out`
- rejected requests cause `dfsm-config` to publish structured errors consumed by `dfsm-error`

### `dfsm-out`

Subscribes to accepted FSM events and emits them into the flow for explicit state-handler logic.

#### Configuration

- **FSM**: reference to a `dfsm-config` node
- **Emit all FSM events**: when enabled, emit every accepted event
- **Resulting state**: when "all" is disabled, only emit events whose resulting state matches this value

#### Input

This node does not receive flow input messages.

#### Output contract

Writes the FSM snapshot to `msg.payload`:

```json
{
  "state": "RUNNING",
  "prevState": "IDLE",
  "changed": true,
  "retrigger": false,
  "context": {
	"setpoint": 1.1
  },
  "eventId": 3,
  "timestamp": 1713260000000
}
```

Use this node to trigger the handler flow for one state, or for all states.

`dfsm-out` publishes state snapshots, not transition requests. Transition-request fields such as `nextState` are scrubbed from outgoing messages.

### `dfsm-error`

Subscribes to explicit FSM errors so rejection paths remain visible in the flow.

#### Configuration

- **FSM**: reference to a `dfsm-config` node

#### Input

This node does not receive flow input messages.

#### Output contract

Writes a structured FSM error to `msg.payload`:

```json
{
  "type": "invalid_state",
  "message": "Requested state \"SANDWICH\" is not allowed.",
  "requestedState": "SANDWICH",
  "currentState": "RUNNING",
  "validStates": ["RUNNING", "STOPPING", "STOPPED"],
  "originalRequest": {
	"state": "SANDWICH"
  },
  "ts": 1713260000000
}
```

Typical first-pass error types include:

- `invalid_state`
- `missing_state`
- `malformed_payload`
- `non_object_context`
- `missing_context`
- `illegal_transition`

Global illegal transitions are rejected before state mutation, produce red `illegal transition` status on `dfsm-in`, and can be observed through `dfsm-error`.

### `dfsm-state-enter`

Emits when a selected state is entered, loosely inspired by IEC SFC set-style state action semantics.

#### Configuration

- **FSM**: reference to a `dfsm-config` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this node. Default is `false`.

#### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

#### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `RUNNING`
- for transition `RUNNING -> RUNNING`, this node emits only if **Trigger on self transition** is enabled
- output payload follows the existing DFSM transition snapshot shape (`prevState`, `state`, `changed`, `retrigger`, `eventId`, `timestamp`, `context`)

### `dfsm-state-exit`

Emits when a selected state is exited, loosely inspired by IEC SFC reset-style state action semantics.

#### Configuration

- **FSM**: reference to a `dfsm-config` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this node. Default is `false`.

#### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

#### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `IDLE`
- for transition `RUNNING -> RUNNING`, this node emits only if **Trigger on self transition** is enabled
- output payload follows the existing DFSM transition snapshot shape (`prevState`, `state`, `changed`, `retrigger`, `eventId`, `timestamp`, `context`)

## Message contracts

### Accepted transition request into `dfsm-in`

```json
{
  "payload": {
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
  "state": "RUNNING",
  "prevState": "RUNNING",
  "changed": false,
  "retrigger": true,
  "context": {
	"setpoint": 1.1
  }
}
```

That handler can then explicitly request either another same-state loop:

```json
{
  "nextState": "RUNNING",
  "context": {
	"setpoint": 1.2
  }
}
```

or an advance to another state:

```json
{
  "nextState": "FINISHING"
}
```

## Usage guidelines

- Keep retained machine state in `dfsm-config`, not in scattered ad hoc node context.
- Use `dfsm-out` to drive visible per-state handler flows.
- Keep next-state decisions in ordinary flow logic so the control path stays readable.
- Keep error paths wired explicitly with `dfsm-error`.
- Avoid hidden automatic transitions; the only first-pass shortcut is the optional default state on `dfsm-in`.
- Invalid states are never auto-created.

## Simple example

One simple pattern is:

1. `dfsm-config` defines states `RUNNING`, `STOPPING`, `STOPPED`
2. `dfsm-out` is filtered to `RUNNING`
3. a function node decides the next state based on the current context
4. `dfsm-in` applies that request
5. `dfsm-error` catches invalid or malformed requests

Conceptually:

```text
dfsm-config ─┬─> dfsm-out (RUNNING) ─> function: decide next state ─> dfsm-in
			 └─> dfsm-error ─> debug/log/alarm path
```

Example decision function output:

```javascript
if (msg.payload.context.control.setpoint > 10) {
  msg.payload = { nextState: "STOPPING" };
} else {
	msg.payload = {
    nextState: "RUNNING",
		context: {
			control: {
				setpoint: msg.payload.context.control.setpoint + 1
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

`dfsm-in` can be configured to allow retrigger behavior for same-state requests. When **Allow retrigger** is disabled,
a request targeting the current state is suppressed and no FSM event is emitted. When **Allow retrigger** is enabled,
a same-state request is accepted and emitted as an FSM event with `msg.payload.retrigger = true`.

If a particular `dfsm-out` handler should ignore same-state retriggers, add a simple filter or switch node that blocks
messages where `msg.payload.retrigger` is `true`, or only allows messages where `msg.payload.changed` is `true`.


## DFSM Utilities

These utility nodes complement the FSM node set and can be used independently in any flow.

### `dfsm-util-latch`

A message buffering and gating utility with one physical input and one output.

It supports three logical input types selected by `msg.topic`.

#### Purpose

Holds messages until a trigger allows them through.  Useful for:
- collecting one or more values before a processing step is ready to receive them
- gating a signal so that messages only pass when an enabling condition is true
- rate-limiting message throughput to one message per trigger

#### Inputs

This node has one physical input.

Logical input type is selected by `msg.topic`:

| `msg.topic` value | Logical input |
|---|---|
| absent or any value other than `"trigger"` / `"clear"` | **message input** – message to buffer or gate |
| `"trigger"` | **trigger** – release queued messages or open/close the gate |
| `"clear"` | **clear** – discard all queued messages without releasing them |

Use a **change** node upstream to set `msg.topic = "trigger"` when you want to trigger release behavior.

Use a **change** node upstream to set `msg.topic = "clear"` when you want to clear/discard queued messages.

#### Output

Emits messages from the msg input, subject to the configured mode.
When released in edge mode, `msg.trigger` is set to the payload of the trigger message that caused the release.

#### Configuration

**Trigger mode** — controls when messages are released:

- `edge` (default) — queue incoming messages; release them only when a trigger arrives.
- `gate` — no queue; messages pass through immediately when the gate is open, or are discarded when closed.
  The gate starts **closed**. A trigger with truthy `msg.payload` opens it; falsy closes it.

**Buffering mode** (edge mode only) — controls how many messages are stored:

- `one` (default) — keep only the most recent message; each new message replaces the previous one.
- `all` — store all incoming messages in a FIFO queue.

**Queue mode** (edge mode only) — controls how many are released per trigger:

- `release-all` (default) — release all queued messages in arrival order on each trigger.
- `release-one` — release only the oldest queued message (front of FIFO) per trigger.

#### Practical examples

**edge + one + release-all** (latest-value latch):

```text
sensor ──> latch (edge, one, release-all) ──> processor
               ^trigger
               |
          ready signal
```

The processor receives the most recent sensor value each time the ready signal fires.

**edge + all + release-one** (rate-limited queue):

```text
fast source ──> latch (edge, all, release-one) ──> slow consumer
                    ^trigger
                    |
               consumer-ready signal
```

Messages accumulate in the queue; the consumer pulls one per cycle.

**gate mode** (conditional pass-through):

```text
stream ──> latch (gate) ──> downstream
               ^trigger (payload: true = open, false = close)
               |
          enable/disable signal
```

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
