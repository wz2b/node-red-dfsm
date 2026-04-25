# Node Reference

This file contains detailed per-node documentation for `@wz2b/node-red-dfsm`.

## dfsm-state-machine

Defines an FSM instance and acts as the authoritative central runtime owner of machine behavior.

### What it retains

- `currentState`
- `previousState`
- shared `context` object
- allowed state list
- initial state
- initial context clone
- monotonically increasing `eventId`

### Configuration

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

### Timing mode

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

### Runtime behavior

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

Transition legality is enforced centrally in the FSM config runtime before any state, context, or event counter is
mutated.

`dfsm-state-machine` also owns active-lifecycle interval scheduling state. This internal state tracks:

- current active state
- whether one `dfsm-active` emission is currently unresolved/in flight
- whether one pending interval emission is queued

Same-state requests are handled by `dfsm-activate` in one of two mutually exclusive ways:

- same-state completion in place (`retrigger` disabled): marks the current activation cycle complete while remaining in
  the same state
- immediate same-state retrigger (`retrigger` enabled): emits an explicit retrigger event in the transition domain

Same-state retriggers are not treated as state transitions for lifecycle purposes:

- they do not dispatch `dfsm-state-exit`
- they do not dispatch `dfsm-state-enter`
- they do not resolve/clear the current active-cycle state used by interval scheduling

Same-state completion (in-place) does resolve/clear the current active-cycle state and does not immediately redispatch
`dfsm-active`.

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

When a request is rejected, the FSM state and retained context remain unchanged and a structured error event is
published for `dfsm-error` subscribers.

Example global transition table:

```json
[
  {
    "from": "IDLE",
    "to": "STARTING"
  },
  {
    "from": "STARTING",
    "to": "RUNNING"
  },
  {
    "from": "STARTING",
    "to": "*"
  },
  {
    "from": "RUNNING",
    "to": "STOPPING"
  },
  {
    "from": "STOPPING",
    "to": "IDLE"
  },
  {
    "from": "*",
    "to": "FAULT"
  }
]
```

## dfsm-activate

Requests that the FSM transition to a target state and applies that request through the configured FSM instance.

Conceptually, `dfsm-activate` is the transition-request node in the flow.

### Activation completion contract

When `dfsm-active` emits a message, that represents one active-cycle dispatch from the FSM.

Your handler flow must eventually signal what happened next by doing one of the following:

- send a message to `dfsm-activate` with a different `nextState` to request a real transition
- send a message to `dfsm-activate` with the same `nextState` to either:
    - complete in place, if **Retrigger on same state** is disabled
    - immediately retrigger, if **Retrigger on same state** is enabled
- send a message to `dfsm-update-context` if you only need to mutate retained context and do not want to request a
  transition

Important: simply finishing the downstream flow or returning from a function node does **not** by itself tell the FSM
that
the active cycle is complete.

If interval scheduling is enabled, the FSM tracks whether an active-cycle dispatch is still in flight. A handler
that never signals completion may prevent later interval-driven active emissions from occurring as expected.

#### Example: periodic RUNNING work

A `dfsm-active` handler for `RUNNING` checks a counter and either keeps running or stops:

```javascript
if (msg.dfsm.context.count >= 5) {
    msg.dfsm = {nextState: "STOPPING"};
    return msg;
}

msg.dfsm = {
    nextState: "RUNNING",
    context: {
        count: msg.dfsm.context.count + 1
    }
};
return msg;
```

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Retrigger on same state**: enabled by default; permits immediate same-state reactivation
- **Default state**: optional fallback next state when no requested next state is provided

### Input contract

Canonical transition requests are read from `msg.dfsm`:

```json
{
  "dfsm": {
    "nextState": "RUNNING",
    "context": {
      "setpoint": 1.2
    },
    "replaceContext": false
  }
}
```

### Input semantics

- canonical transition request field is `msg.dfsm.nextState`
- legacy aliases `msg.nextState` and `msg.payload.nextState` are still accepted during the migration period
- if none of `msg.dfsm.nextState`, legacy `msg.nextState`, legacy `msg.payload.nextState`, or configured `defaultState`
  is available, the request is rejected
- the older local `dfsm-activate` present-state filter is currently disabled and ignored
- the FSM config node applies its optional global allowed-transition rules
- if the FSM config node rejects the requested `current state -> target state` pair as illegal, `dfsm-activate` warns
  and shows red `illegal transition` status
- `msg.dfsm.context` shallow-merges into the retained FSM context
- if `msg.dfsm.replaceContext` is `true`, `msg.dfsm.context` replaces the full retained FSM context
- if the requested state matches the current state:
    - with **Retrigger on same state = true**, it immediately retriggers the same state
    - with **Retrigger on same state = false**, it marks the current activation complete in place (no transition, no
      immediate redispatch)

Interval scheduling does not change the meaning of same-state requests. Interval timers are only a later trigger source.

The FSM config node's allowed-transition table is the global machine rule. `dfsm-activate` currently applies transition
checks in this order:

1. FSM config global allowed-transition check
2. transition application and event dispatch

State-variable meanings are:

- `prevState` = previous state
- `state` = current state
- `nextState` = requested next state

For example, `dfsm-active` may emit:

```json
{
  "dfsm": {
    "prevState": "STARTING",
    "state": "RUNNING"
  }
}
```

A later request into `dfsm-activate` should use:

```json
{
  "dfsm": {
    "nextState": "STOPPING"
  }
}
```

`dfsm-activate` does not treat a prior snapshot `msg.dfsm.state` value as a transition request, and it also ignores
legacy snapshot-like `msg.payload.state` values when `nextState` is absent.

When no custom name is set, `dfsm-activate` displays its configured `defaultState` as its node label.

### Output behavior

`dfsm-activate` does not emit a normal output message itself.

- accepted requests cause `dfsm-state-machine` to publish events consumed by `dfsm-active`
- rejected requests cause `dfsm-state-machine` to publish structured errors consumed by `dfsm-error`

## dfsm-update-context

Updates the retained FSM context without requesting a state transition.

Use this when a handler needs to mutate shared machine data (counters, flags, timestamps, measurements) but should not
change state.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Mode**:
    - `merge` (default): shallow-merge patch into retained context
    - `replace`: replace retained context object

### Input contract

Canonical context updates are read from `msg.dfsm`:

```json
{
  "dfsm": {
    "context": {
      "metrics": {
        "ticks": 4
      }
    },
    "state": "RUNNING"
  }
}
```

- `msg.dfsm.context` is required and must be a plain object
- `msg.dfsm.state` is optional
    - if provided, it must match the current active FSM state
    - if omitted, the current active FSM state is used
- legacy compatibility is retained for `msg.payload.context` / `msg.payload.state` and top-level `msg.context` /
  `msg.state`

### Runtime semantics

- applies context update through FSM-owned merge/replace logic (same semantics as transition context updates)
- does not call transition APIs
- does not change `state`/`prevState`
- does not increment `eventId`
- does not emit `dfsm-active`, `dfsm-state-enter`, or `dfsm-state-exit` lifecycle events
- does not affect interval scheduling state

### Output behavior

Pass-through: forwards the incoming message unchanged.

## dfsm-active

Subscribes to active-lifecycle emissions from `dfsm-state-machine` and emits them into the flow for explicit
state-handler logic.

Conceptually, `dfsm-active` emits the handler flow for a state while that state is active.
Users familiar with IEC SFC may see some similarity to an `N`-style active action, but this node operates within
Node-RED's event-driven runtime.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Emit all FSM events**: when enabled, emit every accepted event
- **Resulting state**: when "all" is disabled, only emit events whose resulting state matches this value

### Input

This node does not receive flow input messages.

### Output contract

Writes the FSM snapshot to `msg.dfsm` and preserves `msg.payload` for application/work data:

```json
{
  "dfsm": {
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
}
```

Use this node to trigger the handler flow for one state, or for all states.

When interval scheduling is enabled in `dfsm-state-machine`, periodic emissions are lifecycle signals (for example
`msg.dfsm.lifecycleType = "active_interval"`), not transition retriggers.

`dfsm-active` publishes state snapshots, not transition requests. Transition-request fields such as `nextState` are
scrubbed from outgoing messages.

## dfsm-error

Subscribes to explicit FSM errors so rejection paths remain visible in the flow.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node

### Input

This node does not receive flow input messages.

### Output contract

Writes a structured FSM error to `msg.dfsm.error` and preserves `msg.payload` for application/work data:

```json
{
  "dfsm": {
    "error": {
      "type": "invalid_state",
      "message": "Requested state \"SANDWICH\" is not allowed.",
      "requestedState": "SANDWICH",
      "currentState": "RUNNING",
      "validStates": [
        "RUNNING",
        "STOPPING",
        "STOPPED"
      ],
      "originalRequest": {
        "state": "SANDWICH"
      },
      "ts": 1713260000000
    }
  }
}
```

Typical first-pass error types include:

- `invalid_state`
- `missing_state`
- `malformed_payload`
- `non_object_context`
- `missing_context`
- `illegal_transition`

Global illegal transitions are rejected before state mutation, produce red `illegal transition` status on
`dfsm-activate`, and can be observed through `dfsm-error`.

## dfsm-summary

Generates a summary of a selected `dfsm-state-machine` when it receives an input message. Output can be plain Markdown (
default) or clean HTML suitable for dashboard template nodes.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Format**: `markdown` (default) or `html`

### Input

One message input. Any received message triggers summary generation.

### Output contract

Replaces `msg.payload` with a string containing:

- state machine name
- initial state
- state list
- allowed transition list
- interval settings summary (enabled, interval ms, and configured policy/mode)

**Markdown mode** emits plain Markdown text using headings (`#`, `##`) and bullet lists (`-`).

**HTML mode** emits clean HTML using standard tags (`<h1>`, `<h2>`, `<ul>`, `<li>`, `<strong>`). All user-provided
values (machine name, state names, transition values) are HTML-escaped. No scripts, styles, or inline event handlers are
included. Intended for use with Node-RED dashboard template nodes or similar.

## dfsm-trace

Subscribes to selected `dfsm-state-machine` event channels and emits normalized trace messages.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **Include state enter**
- **Include state exit**
- **Include state active**
- **Include dfsm error**

### Input

No input. This node is an event-source subscriber.

### Output contract

Sets `msg.topic` to one of:

- `state-enter`
- `state-exit`
- `state-active`
- `dfsm-error`

Writes a normalized trace object to `msg.dfsm.trace`:

```json
{
  "dfsm": {
    "trace": {
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
  }
}
```

Use `dfsm-trace` when you want one consolidated trace stream. Use `dfsm-state-enter`, `dfsm-state-exit`, `dfsm-active`,
and `dfsm-error` when you want separate dedicated event branches in the flow.

## dfsm-state-enter

Emits when a selected state is entered.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this
  node. Default is `false`.

### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `RUNNING`
- accepted same-state requests (`RUNNING -> RUNNING`) do not dispatch enter lifecycle from `dfsm-state-machine`
- output DFSM metadata is written under `msg.dfsm` with the transition snapshot shape (`prevState`, `state`, `changed`,
  `retrigger`, `eventId`, `timestamp`, `context`)

## dfsm-state-exit

Emits when a selected state is exited.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node
- **State**: one selected state from a dropdown populated by the associated FSM config node
- **Trigger on self transition**: when enabled, same-state transitions such as `RUNNING -> RUNNING` also trigger this
  node. Default is `false`.

### Label behavior

- uses **Name** when provided
- otherwise uses the selected **State**

### Output behavior

- for transition `IDLE -> RUNNING`, this node emits when configured state is `IDLE`
- accepted same-state requests (`RUNNING -> RUNNING`) do not dispatch exit lifecycle from `dfsm-state-machine`
- output DFSM metadata is written under `msg.dfsm` with the transition snapshot shape (`prevState`, `state`, `changed`,
  `retrigger`, `eventId`, `timestamp`, `context`)

## Lifecycle phase ordering

- For state-changing transitions, lifecycle phases are serialized as `EXIT -> ENTER -> ACTIVE`.
- `dfsm-state-machine` waits for completion signals from matching blocking `dfsm-state-exit` handlers before dispatching
  the new state's `ENTER` handlers.
- `dfsm-state-machine` waits for completion signals from matching blocking `dfsm-state-enter` handlers before
  dispatching `dfsm-active`.
- If a state has no matching ENTER handlers, `dfsm-active` is emitted immediately after EXIT phase completion.
- At most one blocking handler may govern a launched EXIT step, and at most one blocking handler may govern a launched
  ENTER step. Multiple matching blocking handlers are rejected as ambiguous.
- Non-blocking observers are still allowed and do not hold up lifecycle progression.
- EXIT/ENTER lifecycle messages include phase-correlation metadata under `msg.dfsm`: `lifecyclePhase`,
  `lifecyclePhaseId`, `fromState`, `toState`, and `lifecyclePhaseState`.
- Blocking-phase completion is matched primarily against the runtime's current in-flight lifecycle step.
- If completion metadata is provided (`msg.dfsm.lifecyclePhaseId` / `msg.dfsm.lifecyclePhase`), it is validated and
  mismatches are rejected.

## dfsm-attach-snapshot

Enriches any incoming message with the current retained FSM snapshot of a selected FSM instance.

### Purpose

In real flows, asynchronous or third-party work nodes may not preserve the original FSM activation message. When that
happens, downstream logic can lose access to current FSM information even though it still needs it to determine the next
action.

`dfsm-attach-snapshot` provides a clean alternative: it fetches the current retained FSM snapshot at processing time and
attaches it to the outgoing message, without requiring the original activation message to be threaded through the entire
work path.

### Configuration

- **FSM**: reference to a `dfsm-state-machine` node

### Input

One message input. Any incoming message is accepted.

### Output behavior

- preserves all unrelated incoming message properties
- attaches current FSM snapshot fields under `msg.dfsm`:
    - `msg.dfsm.state` — current FSM state name
    - `msg.dfsm.prevState` — previous FSM state name, or `null` if no transition has occurred yet
    - `msg.dfsm.context` — a **clone** of the retained FSM context object (safe from external mutation)
    - `msg.dfsm.eventId` — current event counter from the FSM runtime
- does not change FSM state, increment eventId, or request a transition
- does not emit FSM lifecycle events
- emits a `snapshot-attached` trace event visible through `dfsm-trace` when configured

### Example: recovering FSM state after async work

```text
dfsm-state-enter (WORK)
    ↓
HTTP request (may lose original msg)
    ↓
dfsm-attach-snapshot  ← reattaches current FSM state
    ↓
switch (msg.dfsm.state)
    ├→ case "WORK": → next-state logic
    └→ ...
```

When the HTTP node responds, the original `dfsm-state-enter` message may have been dropped or lost.
`dfsm-attach-snapshot` allows you to recover the current FSM information at that point.

## dfsm-util-latch

A message buffering and gating utility with one physical input and one output.

It supports three logical input types (message, trigger, clear). Trigger detection can come from `msg.topic` or one
configured rule.

### Purpose

Holds messages until a trigger allows them through. Useful for:

- collecting one or more values before a processing step is ready to receive them
- gating a signal so that messages only pass when an enabling condition is true
- rate-limiting message throughput to one message per trigger

### Inputs

This node has one physical input.

Logical input type is selected by `msg.topic`:

| `msg.topic` value                        | Logical input                                                                           |
|------------------------------------------|-----------------------------------------------------------------------------------------|
| absent or any value other than `"clear"` | **message input** – message to buffer or gate (unless trigger rule/topic match applies) |
| `"trigger"`                              | **trigger** – release/open/close when `Trigger source = topic`                          |
| `"clear"`                                | **clear** – discard all queued messages without releasing them                          |

When `Trigger source = rule`, trigger detection no longer depends on `msg.topic === "trigger"`; the configured rule
determines trigger messages.
`clear` remains topic-based and always uses `msg.topic === "clear"`.

Use a **change** node upstream to set `msg.topic = "trigger"` when you want to trigger release behavior.

Use a **change** node upstream to set `msg.topic = "clear"` when you want to clear/discard queued messages.

### Output

Emits messages from the msg input, subject to the configured mode.
When released in edge mode, `msg.trigger` is set to the payload of the trigger message that caused the release.

### Configuration

**Trigger mode** — controls when messages are released:

- `edge` (default) — queue incoming messages; release them only when a trigger arrives.
- `gate` — no queue; messages pass through immediately when the gate is open, or are discarded when closed.
  The gate starts **closed**. A trigger with truthy `msg.payload` opens it; falsy closes it.

**Trigger source** — controls how a trigger is detected:

- `topic` (default) — backward-compatible behavior: trigger when `msg.topic === "trigger"`.
- `rule` — trigger when one configured rule matches one selected message property.

Supported rule operators: `eq`, `neq`, `contains`, `exists`, `truthy`, `falsy`.

Only one trigger rule is supported by design.
When using `rule`, a matching rule message is treated as a trigger only and is not also queued as a data message.

**Buffering mode** (edge mode only) — controls how many messages are stored:

- `one` (default) — keep only the most recent message; each new message replaces the previous one.
- `all` — store all incoming messages in a FIFO queue.

**Queue mode** (edge mode only) — controls how many are released per trigger:

- `release-all` (default) — release all queued messages in arrival order on each trigger.
- `release-one` — release only the oldest queued message (front of FIFO) per trigger.

**Release format** (edge mode only) — controls output shape when queued messages are released:

- `individual` (default) — backward-compatible behavior; emit each released queued message as its own Node-RED message.
- `payload-array` — emit one message; set `msg.payload` to an array of queued payload values in FIFO order.
- `message-array` — emit one message; set `msg.payload` to an array of complete queued message objects in FIFO order.

For all release formats, `msg.trigger` is set to the trigger payload that caused the release.

### Common mode combinations

The latch has several options, but most flows use one of these patterns:

| Pattern             | Configuration                                    | What it does                                                                                     | Typical use                                                                       |
|---------------------|--------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| Latest-value latch  | `edge` + `one` + `release-all` + `individual`    | Keeps only the most recent message and emits it when triggered.                                  | Sample a changing value only when downstream logic is ready.                      |
| FIFO queue          | `edge` + `all` + `release-one` + `individual`    | Stores all messages and releases the oldest one per trigger.                                     | Rate-limit a fast producer feeding a slower consumer.                             |
| Flush queue         | `edge` + `all` + `release-all` + `individual`    | Stores all messages and emits them individually in FIFO order when triggered.                    | Hold work until a process reaches a ready/active state.                           |
| Batch payloads      | `edge` + `all` + `release-all` + `payload-array` | Stores all messages and emits one message whose payload is an array of queued payloads.          | Batch events, readings, or work items for one downstream operation.               |
| Batch full messages | `edge` + `all` + `release-all` + `message-array` | Stores all messages and emits one message whose payload is an array of complete queued messages. | Batch messages while preserving `topic`, correlation IDs, or `msg.dfsm` metadata. |
| Conditional gate    | `gate`                                           | Does not queue; passes messages only while the gate is open.                                     | Enable or disable a live stream based on a control signal.                        |

### Practical examples

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

**edge + all + release-all + payload-array** (batch release):

```text
events ──> latch (edge, all, release-all, payload-array) ──> batch processor
             ^trigger
             |
        flush signal
```

Messages accumulate in FIFO order and are emitted as one array payload per trigger.

**message-array format** is useful when downstream logic must preserve message metadata such as `topic`, correlation
IDs, or `msg.dfsm` fields.

**gate mode** (conditional pass-through):

```text
stream ──> latch (gate) ──> downstream
               ^trigger (payload: true = open, false = close)
               |
          enable/disable signal
```

