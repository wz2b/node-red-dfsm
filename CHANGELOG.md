# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `dfsm-attach-snapshot` node for attaching current retained FSM snapshot to messages.
  - Enriches any incoming message with current FSM state, prevState, context, and eventId fields.
  - Useful for recovering FSM state after asynchronous or third-party work nodes that may lose the original activation message.
  - Does not trigger transitions, completions, or lifecycle events.
  - Emits a `snapshot-attached` trace event visible through `dfsm-trace`.
- `dfsm-trace` support for two new event channels:
  - `includeCompletion`: enables tracing of `activation-complete` events from `dfsm-complete-activation`.
  - `includeSnapshotAttached`: enables tracing of `snapshot-attached` events from `dfsm-attach-snapshot`.
- Runtime FSM support for snapshot attachment tracing:
  - `node.subscribeSnapshotAttached(handler)` subscribes to snapshot-attached trace events.
  - `node.publishSnapshotAttached(traceEvent, msg)` publishes a snapshot-attached trace event to subscribers.

### Changed

- DFSM message contracts are now canonically namespaced under `msg.dfsm` so `msg.payload` remains available for ordinary application/work data.
  - `dfsm-active`, `dfsm-state-enter`, `dfsm-state-exit`, and `dfsm-attach-snapshot` now emit FSM snapshot metadata under `msg.dfsm`.
  - `dfsm-error` now emits error metadata under `msg.dfsm.error`.
  - `dfsm-trace` now emits trace metadata under `msg.dfsm.trace` while preserving `msg.payload`.
  - `dfsm-activate` and `dfsm-update-context` now prefer canonical `msg.dfsm` input fields.
  - Legacy input compatibility is retained for a transition period: `msg.payload.nextState`, `msg.payload.context`, `msg.payload.state`, and top-level aliases such as `msg.nextState`, `msg.context`, and `msg.state` are still accepted where documented.
  - DFSM nodes no longer emit the old payload-based metadata structure by default.
- **Breaking change:** renamed config/runtime node type `dfsm-config` to `dfsm-state-machine`.
  - Migration: existing flows, examples, and imported JSON must update node `type` from `dfsm-config` to `dfsm-state-machine`.
  - This is a rename only; runtime FSM semantics and message contracts are unchanged.
- **Breaking change:** renamed public node types for clearer FSM terminology.
  - `dfsm-in` is now `dfsm-activate`
  - `dfsm-out` is now `dfsm-active`
  - Existing flows, examples, and imported JSON must update the node `type` values accordingly.
- `dfsm-state-machine`: accepted same-state requests are no longer treated as enter/exit lifecycle transitions.
  - Same-state accepted requests do not emit `dfsm-state-exit` or `dfsm-state-enter`.
  - Same-state accepted requests do not resolve the current `dfsm-active` unresolved cycle used by interval scheduling.
- `dfsm-activate`: same-state requests now distinguish completion from immediate retrigger.
  - With `Retrigger on same state` disabled, a same-state request marks activation complete in place (no transition, no immediate redispatch).
  - With `Retrigger on same state` enabled, a same-state request performs immediate retrigger behavior.
  - Same-state completion semantics are independent of interval scheduling; interval timers are only a later trigger source.
- `dfsm-active`: now consumes config-owned active-lifecycle emissions (with transition snapshots and optional periodic interval lifecycle signals).

### Added

- First-pass explicit FSM node set for Node-RED: `dfsm-state-machine`, `dfsm-activate`, `dfsm-active`, and `dfsm-error`.
- `dfsm-summary` node.
  - Input-triggered markdown export helper for `dfsm-state-machine`.
  - Emits plain markdown summary (machine name, initial state, states, allowed transitions, interval settings) to `msg.payload`.
  - Now supports a `format` configuration option (`markdown` | `html`).
    - `markdown` (default) — preserves existing plain Markdown output.
    - `html` — emits clean HTML using standard tags (`<h1>`, `<h2>`, `<ul>`, `<li>`, `<strong>`). All user-provided values are HTML-escaped. Intended for use with Node-RED dashboard template nodes or similar.
- `dfsm-trace` node.
  - Observational trace subscriber for selected event channels: enter, exit, active lifecycle, and error.
  - Emits normalized trace payloads with stable `traceType` and `msg.topic` for logging/storage flows.
- `dfsm-update-context` node.
  - Updates retained `dfsm-state-machine` context without requesting a state transition.
  - Supports `merge` (default) and `replace` update modes.
  - Forwards input messages unchanged while preserving FSM transition/lifecycle/interval semantics.
- Central retained FSM state and shared context handling with explicit accepted-event and error-event fan-out.
- Trigger/latch-style flow building support for visible state handlers, visible next-state decisions, and visible error paths.
- Initial test coverage for accepted transitions, retriggers, default-state handling, and rejected transition behavior.
- `dfsm-util-latch`: a three-input buffering and gating utility node.
  - Supports edge mode (queue + release on trigger) and gate mode (immediate pass-through when open).
  - Buffering mode: `one` (latest only) or `all` (FIFO queue).
  - Queue mode: `release-all` or `release-one` per trigger.
  - Messages are always released in FIFO order.
  - Input routing by `msg.topic`: `"trigger"`, `"clear"`, or absent/other for the message input.
  - Full test coverage for all behavior branches.
- `dfsm-activate`: optional transition guard with **Allowable Previous States**.
  - Empty field keeps backward-compatible behavior (no guard).
  - When configured, transitions are accepted only if the FSM's current state matches one of the configured states.
  - Illegal transition attempts are rejected, emit warning text, and set red node status `illegal transition`.
- Optional global allowed-transition enforcement in `dfsm-state-machine`.
  - FSM config now supports an editable `from -> to` transition table on a new `Transitions` tab.
  - If the table is empty, all valid transitions remain allowed.
  - If rules are configured, only matching transitions are legal, with wildcard support such as `* -> FAULT` and `STARTING -> *`.
  - Illegal transitions are rejected centrally in `fsm.next(request, msg)` before any state mutation or accepted-event dispatch.
  - `dfsm-activate` warns and shows red `illegal transition` status when the global rule check rejects a request.
  - Illegal transition rejections are emitted through the existing `dfsm-error` path.
- `dfsm-state-enter` node.
  - Emits when a selected state is entered.
  - Uses a state dropdown populated from the selected `dfsm-state-machine` node.
  - Supports optional same-state triggering via `triggerOnSelfTransition` (default `false`).
- `dfsm-state-exit` node.
  - Emits when a selected state is exited.
  - Uses a state dropdown populated from the selected `dfsm-state-machine` node.
  - Supports optional same-state triggering via `triggerOnSelfTransition` (default `false`).
- `dfsm-state-machine` lifecycle dispatch support for state-enter and state-exit notifications.
  - Accepted transitions now dispatch exit lifecycle events before enter lifecycle events.
- Config-owned active interval scheduler in `dfsm-state-machine`.
  - New `Interval` tab in `dfsm-state-machine` editor for `Enable interval emissions`, cadence, in-flight policy (`skip`/`queue_one`), and timing mode (`fixed_rate`/`fixed_delay`).
  - Scheduler tracks real unresolved/in-flight active-cycle state and centralizes timer cleanup on state change and node close.
  - Periodic active emissions are lifecycle signals, not state transitions or same-state retriggers.

### Fixed

- `dfsm-state-machine` lifecycle ordering for state-changing transitions is now serialized as `EXIT -> ENTER -> ACTIVE`.
  - `dfsm-active` no longer dispatches back-to-back with `dfsm-state-enter`.
  - Blocking `dfsm-state-exit` handlers must complete before ENTER begins.
  - Blocking `dfsm-state-enter` handlers must complete before ACTIVE dispatch.
  - Prevents ACTIVE handlers from observing stale context when ENTER handlers update retained context first.
  - **Behavior change:** blocking lifecycle phases now use a single in-flight step model (no counting semaphore).
  - Each launched EXIT/ENTER phase allows at most one matching blocking handler; ambiguous matches are rejected with `lifecycle_blocking_ambiguous`.
  - `lifecyclePhaseId` remains available for diagnostics/tracing, but phase completion no longer requires metadata when a runtime in-flight step exists.
  - If lifecycle metadata is provided, mismatches are rejected explicitly with `lifecycle_phase_mismatch`.
  - Phase advancement completion callbacks are deferred to avoid re-entrant EXIT/ENTER progression within the same dispatch stack.
  - EXIT/ENTER completion events now include explicit phase trace fields (`lifecyclePhase`, `lifecyclePhaseId`, `phaseState`, `fromState`, `toState`) and clearer messages.
- `dfsm-util-latch`: corrected editor/UI and documentation to match runtime behavior.
  - Node registration now uses one physical input (`inputs: 1`).
  - Removed incorrect multi-port labeling from editor metadata.
  - Help and README now consistently describe one physical input with three logical input types selected by `msg.topic` (`message`, `trigger`, `clear`).
- `dfsm-activate`: `Allowable Previous States` now uses an FSM-backed multi-select list in the editor instead of freeform text.
  - Choices are populated from the selected FSM config node states.
  - Selections are preserved when possible when FSM config selection changes.
  - Selected values are stored as a JSON array; runtime keeps backward compatibility with legacy comma-separated values.
- `dfsm-activate`: the local `Allowable Previous States` / present-state filter is temporarily disabled in both the editor UI and runtime.
  - Existing stored values are preserved but ignored.
  - Global FSM transition-table enforcement remains active and is now the primary transition-guard mechanism.
- `dfsm-activate`: transition requests now prefer `nextState` to avoid ambiguity with state snapshots.
  - Requested state resolution order is `msg.payload.nextState`, `msg.nextState`, then configured `defaultState`.
  - Snapshot fields such as `payload.state` are no longer interpreted as transition requests.
  - If no custom name is set, node labels now display configured `defaultState` when present.
- `dfsm-active`: transition-request fields are scrubbed from emitted messages.
  - Removes top-level `msg.nextState` and any `payload.nextState` before publishing state snapshots.

## [0.1.5] - 2026-04-15
