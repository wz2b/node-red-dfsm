# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking change:** renamed public node types for clearer FSM terminology.
  - `dfsm-in` is now `dfsm-activate`
  - `dfsm-out` is now `dfsm-active`
  - Existing flows, examples, and imported JSON must update the node `type` values accordingly.
- `dfsm-config`: accepted same-state requests are no longer treated as enter/exit lifecycle transitions.
  - Same-state accepted requests do not emit `dfsm-state-exit` or `dfsm-state-enter`.
  - Same-state accepted requests do not resolve the current `dfsm-active` unresolved cycle used by interval scheduling.
- `dfsm-active`: now consumes config-owned active-lifecycle emissions (with transition snapshots and optional periodic interval lifecycle signals).

### Added

- First-pass explicit FSM node set for Node-RED: `dfsm-config`, `dfsm-activate`, `dfsm-active`, and `dfsm-error`.
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
- Optional global allowed-transition enforcement in `dfsm-config`.
  - FSM config now supports an editable `from -> to` transition table on a new `Transitions` tab.
  - If the table is empty, all valid transitions remain allowed.
  - If rules are configured, only matching transitions are legal, with wildcard support such as `* -> FAULT` and `STARTING -> *`.
  - Illegal transitions are rejected centrally in `fsm.next(request, msg)` before any state mutation or accepted-event dispatch.
  - `dfsm-activate` warns and shows red `illegal transition` status when the global rule check rejects a request.
  - Illegal transition rejections are emitted through the existing `dfsm-error` path.
- `dfsm-state-enter` node.
  - Emits when a selected state is entered.
  - Uses a state dropdown populated from the selected `dfsm-config` node.
  - Supports optional same-state triggering via `triggerOnSelfTransition` (default `false`).
- `dfsm-state-exit` node.
  - Emits when a selected state is exited.
  - Uses a state dropdown populated from the selected `dfsm-config` node.
  - Supports optional same-state triggering via `triggerOnSelfTransition` (default `false`).
- `dfsm-config` lifecycle dispatch support for state-enter and state-exit notifications.
  - Accepted transitions now dispatch exit lifecycle events before enter lifecycle events.
- Config-owned active interval scheduler in `dfsm-config`.
  - New `Interval` tab in `dfsm-config` editor for `Enable interval emissions`, cadence, in-flight policy (`skip`/`queue_one`), and timing mode (`fixed_rate`/`fixed_delay`).
  - Scheduler tracks real unresolved/in-flight active-cycle state and centralizes timer cleanup on state change and node close.
  - Periodic active emissions are lifecycle signals, not state transitions or same-state retriggers.

### Fixed

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
