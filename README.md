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
## Node set

The library adds a new Node-RED section named **state machine** containing:

- `dfsm-state-machine`
- `dfsm-activate`
- `dfsm-update-context`
- `dfsm-state-enter`
- `dfsm-active`
- `dfsm-state-exit`
- `dfsm-error`
- `dfsm-summary`
- `dfsm-trace`
- `dfsm-util-latch`

## Nodes

### `dfsm-state-machine`

Defines an FSM instance and acts as the authoritative central runtime owner of machine behavior.

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
- **Interval tab** (optional): config-owned periodic active-lifecycle scheduling
  - `Enable interval emissions`
  - `Interval ms`
  - `In-flight policy`: `skip` or `queue_one`
  - `Timing mode`: `fixed_rate` or `fixed_delay`


#### Timing mode

- **fixed_rate**  
  Emit on a fixed wall-clock schedule (every `N` ms). The scheduler runs continuously and is not re-phased on
  state entry. Emissions do not wait for the previous active cycle to complete; if a prior cycle is still unresolved,
  overlap is handled by the configured in-flight policy.

- **fixed_delay**  
  Emit `N` ms after the previous active cycle completes. This guarantees a delay between completed cycles and avoids 
  overlap by construction.

In **fixed_rate** mode, the interval behaves like a controller-owned scan clock. It runs continuously and is not 
synchronized to the moment a state becomes active. State handlers execute in response to that clock only when the
previous activation cycle has completed.

Because `fixed_rate` is not synchronized to state entry, the first interval emission after entering a state may
occur sooner than the full configured interval.


#### Runtime behavior

On startup the FSM initializes to:

- `currentState = initialState`
- `previousState = null`
- `context = clone(initialContext || {})`
- `eventId = 0`

The config node accepts normalized transition requests from `dfsm-activate`.

Allowed transitions are optional:

- if no transition rules are configured, all valid state-to-state requests are allowed
- if transition rules are configured, only listed transitions are legal
- use `*` as the `from` state to allow a transition from any current state, for example `* -> FAULT`
- use `*` as the `to` state to allow a transition to any valid target state, for example `STARTING -> *`

Transition legality is enforced centrally in the FSM config runtime before any state, context, or event counter is mutated.

`dfsm-state-machine` also owns active-lifecycle interval scheduling state. This internal state tracks:

- current active state
- whether one `dfsm-active` emission is currently unresolved/in flight
- whether one pending interval emission is queued

Same-state requests are handled by `dfsm-activate` in one of two mutually exclusive ways:

- same-state completion in place (`retrigger` disabled): marks the current activation cycle complete while remaining in the same state
- immediate same-state retrigger (`retrigger` enabled): emits an explicit retrigger event in the transition domain

Same-state retriggers are not treated as state transitions for lifecycle purposes:

- they do not dispatch `dfsm-state-exit`
- they do not dispatch `dfsm-state-enter`
- they do not resolve/clear the current active-cycle state used by interval scheduling

Same-state completion (in-place) does resolve/clear the current active-cycle state and does not immediately redispatch `dfsm-active`.

Only accepted state-changing requests resolve the current active cycle.

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

### `dfsm-activate`

Requests that the FSM transition to a target state and applies that request through the configured FSM instance.

Conceptually, `dfsm-activate` is the transition-request node in the flow.

### Activation completion contract

When `dfsm-active` emits a message, that represents one active-cycle dispatch from the FSM.

Your handler flow must eventually signal what happened next by doing one of the following:

- send a message to `dfsm-activate` with a different `nextState` to request a real transition
- send a message to `dfsm-activate` with the same `nextState` to either:
  - complete in place, if **Retrigger on same state** is disabled
  - immediately retrigger, if **Retrigger on same state** is enabled
- send a message to `dfsm-update-context` if you only need to mutate retained context and do not want to request a transition

Important: simply finishing the downstream flow or returning from a function node does **not** by itself tell the FSM that
the active cycle is complete.

If interval scheduling is enabled, the FSM tracks whether an active-cycle dispatch is still in flight. A handler
that never signals completion may prevent later interval-driven active emissions from occurring as expected.

#### Example: periodic RUNNING work

A `dfsm-active` handler for `RUNNING` checks a counter and either keeps running or stops:

```javascript
if (msg.payload.context.count >= 5) {
  msg.payload = { nextState: "STOPPING" };
  return msg;
}

msg.payload = {
  nextState: "RUNNING",
  context: {
    count: msg.payload.context.count + 1
  }
};
return msg;
```

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Retrigger on same state**: enabled by default; permits immediate same-state reactivation
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
- the older local `dfsm-activate` present-state filter is currently disabled and ignored
- the FSM config node applies its optional global allowed-transition rules
- if the FSM config node rejects the requested `current state -> target state` pair as illegal, `dfsm-activate` warns and shows red `illegal transition` status
- `payload.context` shallow-merges into the retained FSM context
- if `payload.replaceContext` is `true`, `payload.context` replaces the full retained FSM context
- if the requested state matches the current state:
  - with **Retrigger on same state = true**, it immediately retriggers the same state
  - with **Retrigger on same state = false**, it marks the current activation complete in place (no transition, no immediate redispatch)

Interval scheduling does not change the meaning of same-state requests. Interval timers are only a later trigger source.

The FSM config node's allowed-transition table is the global machine rule. `dfsm-activate` currently applies transition checks in this order:

1. FSM config global allowed-transition check
2. transition application and event dispatch

State-variable meanings are:

- `prevState` = previous state
- `state` = current state
- `nextState` = requested next state

For example, `dfsm-active` may emit:

```json
{ "prevState": "STARTING", "state": "RUNNING" }
```

A later request into `dfsm-activate` should use:

```json
{ "nextState": "STOPPING" }
```

`dfsm-activate` does not treat a prior snapshot `payload.state` value as a transition request.

When no custom name is set, `dfsm-activate` displays its configured `defaultState` as its node label.

#### Output behavior

`dfsm-activate` does not emit a normal output message itself.

- accepted requests cause `dfsm-state-machine` to publish events consumed by `dfsm-active`
- rejected requests cause `dfsm-state-machine` to publish structured errors consumed by `dfsm-error`

### `dfsm-update-context`

Updates the retained FSM context without requesting a state transition.

Use this when a handler needs to mutate shared machine data (counters, flags, timestamps, measurements) but should not change state.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Mode**:
  - `merge` (default): shallow-merge patch into retained context
  - `replace`: replace retained context object

#### Input contract

Reads from `msg.payload`:

```json
{
  "context": {
    "metrics": {
      "ticks": 4
    }
  },
  "state": "RUNNING"
}
```

- `payload.context` is required and must be a plain object
- `payload.state` is optional
  - if provided, it must match the current active FSM state
  - if omitted, the current active FSM state is used

#### Runtime semantics

- applies context update through FSM-owned merge/replace logic (same semantics as transition context updates)
- does not call transition APIs
- does not change `state`/`prevState`
- does not increment `eventId`
- does not emit `dfsm-active`, `dfsm-state-enter`, or `dfsm-state-exit` lifecycle events
- does not affect interval scheduling state

#### Output behavior

Pass-through: forwards the incoming message unchanged.

### `dfsm-active`

Subscribes to active-lifecycle emissions from `dfsm-state-machine` and emits them into the flow for explicit state-handler logic.

Conceptually, `dfsm-active` emits the handler flow for a state while that state is active.
Users familiar with IEC SFC may see some similarity to an `N`-style active action, but this node operates within
Node-RED's event-driven runtime.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
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

When interval scheduling is enabled in `dfsm-state-machine`, periodic emissions are lifecycle signals (for example `lifecycleType = "active_interval"`), not transition retriggers.

`dfsm-active` publishes state snapshots, not transition requests. Transition-request fields such as `nextState` are scrubbed from outgoing messages.

### `dfsm-error`

Subscribes to explicit FSM errors so rejection paths remain visible in the flow.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node

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

Global illegal transitions are rejected before state mutation, produce red `illegal transition` status on `dfsm-activate`, and can be observed through `dfsm-error`.

### `dfsm-summary`

Generates a summary of a selected `dfsm-state-machine` when it receives an input message. Output can be plain Markdown (default) or clean HTML suitable for dashboard template nodes.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Format**: `markdown` (default) or `html`

#### Input

One message input. Any received message triggers summary generation.

#### Output contract

Replaces `msg.payload` with a string containing:

- state machine name
- initial state
- state list
- allowed transition list
- interval settings summary (enabled, interval ms, and configured policy/mode)

**Markdown mode** emits plain Markdown text using headings (`#`, `##`) and bullet lists (`-`).

**HTML mode** emits clean HTML using standard tags (`<h1>`, `<h2>`, `<ul>`, `<li>`, `<strong>`). All user-provided values (machine name, state names, transition values) are HTML-escaped. No scripts, styles, or inline event handlers are included. Intended for use with Node-RED dashboard template nodes or similar.

### `dfsm-trace`

Subscribes to selected `dfsm-state-machine` event channels and emits normalized trace messages.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Include state enter**
- **Include state exit**
- **Include state active**
- **Include dfsm error**

#### Input

No input. This node is an event-source subscriber.

#### Output contract

Sets `msg.topic` to one of:

- `state-enter`
- `state-exit`
- `state-active`
- `dfsm-error`

Writes a normalized trace object to `msg.payload`:

```json
{
  "traceType": "state-enter | state-exit | state-active | dfsm-error",
  "state": "RUNNING",
  "prevState": "IDLE",
  "changed": true,
  "retrigger": false,
  "timestamp": 1713260000000,
  "eventId": 3,
  "error": null,
  "message": "ENTER state RUNNING"
}
```

Use `dfsm-trace` when you want one consolidated trace stream. Use `dfsm-state-enter`, `dfsm-state-exit`, `dfsm-active`, and `dfsm-error` when you want separate dedicated event branches in the flow.

### `dfsm-state-enter`

Emits when a selected state is entered.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this node. Default is `false`.

#### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

#### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `RUNNING`
- accepted same-state requests (`RUNNING -> RUNNING`) do not dispatch enter lifecycle from `dfsm-state-machine`
- output payload follows the existing DFSM transition snapshot shape (`prevState`, `state`, `changed`, `retrigger`, `eventId`, `timestamp`, `context`)

### `dfsm-state-exit`

Emits when a selected state is exited.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this node. Default is `false`.

#### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

#### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `IDLE`
- accepted same-state requests (`RUNNING -> RUNNING`) do not dispatch exit lifecycle from `dfsm-state-machine`
- output payload follows the existing DFSM transition snapshot shape (`prevState`, `state`, `changed`, `retrigger`, `eventId`, `timestamp`, `context`)

### `dfsm-attach-snapshot`

Enriches any incoming message with the current retained FSM snapshot of a selected FSM instance.

#### Purpose

In real flows, asynchronous or third-party work nodes may not preserve the original FSM activation message. When that happens, downstream logic can lose access to current FSM information even though it still needs it to determine the next action.

`dfsm-attach-snapshot` provides a clean alternative: it fetches the current retained FSM snapshot at processing time and attaches it to the outgoing message, without requiring the original activation message to be threaded through the entire work path.

#### Configuration

- **FSM**: reference to a `dfsm-state-machine` node

#### Input

One message input. Any incoming message is accepted.

#### Output behavior

- preserves all unrelated incoming message properties
- attaches current FSM snapshot fields at the message top level:
  - `msg.state` — current FSM state name
  - `msg.prevState` — previous FSM state name, or `null` if no transition has occurred yet
  - `msg.context` — a **clone** of the retained FSM context object (safe from external mutation)
  - `msg.eventId` — current event counter from the FSM runtime
- does not change FSM state, increment eventId, or request a transition
- does not emit FSM lifecycle events
- emits a `snapshot-attached` trace event visible through `dfsm-trace` when configured

#### Example: recovering FSM state after async work

```
dfsm-state-enter (WORK)
    ↓
HTTP request (may lose original msg)
    ↓
dfsm-attach-snapshot  ← reattaches current FSM state
    ↓
switch (msg.state)
    ├→ case "WORK": → next-state logic
    └→ ...
```

When the HTTP node responds, the original `dfsm-state-enter` message may have been dropped or lost. `dfsm-attach-snapshot` allows you to recover the current FSM information at that point.

## Message contracts

### Accepted transition request into `dfsm-activate`

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

`dfsm-activate` can be configured to allow immediate retrigger behavior for same-state requests.

- When **Retrigger on same state** is disabled, a same-state request marks the current activation complete in place and does not immediately emit a new `dfsm-active` event.
- When **Retrigger on same state** is enabled, a same-state request is emitted as an explicit immediate retrigger event (`msg.payload.retrigger = true`).

Immediate same-state retrigger can create tight loops and is usually not desired when interval firing/scanning is used.

Same-state retriggers are transition events only. They do not emit `dfsm-state-enter`/`dfsm-state-exit`, and they do not resolve
the active-cycle state used by config-owned interval scheduling.

If a particular `dfsm-active` handler should ignore same-state retriggers, add a simple filter or switch node that blocks
messages where `msg.payload.retrigger` is `true`, or only allows messages where `msg.payload.changed` is `true`.

## Breaking rename note

This package now uses `dfsm-activate` and `dfsm-active` instead of `dfsm-in` and `dfsm-out`.

Existing flows and example JSON that still reference the old node types must be updated before import or deploy:

- `dfsm-in` → `dfsm-activate`
- `dfsm-out` → `dfsm-active`


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
