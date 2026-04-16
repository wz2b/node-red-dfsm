# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- First-pass explicit FSM node set for Node-RED: `dfsm-config`, `dfsm-in`, `dfsm-out`, and `dfsm-error`.
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
- `dfsm-in`: optional transition guard with **Allowable Previous States**.
  - Empty field keeps backward-compatible behavior (no guard).
  - When configured, transitions are accepted only if the FSM's current state matches one of the configured states.
  - Illegal transition attempts are rejected, emit warning text, and set red node status `illegal transition`.
- Optional global allowed-transition enforcement in `dfsm-config`.
  - FSM config now supports an editable `from -> to` transition table on a new `Transitions` tab.
  - If the table is empty, all valid transitions remain allowed.
  - If rules are configured, only matching transitions are legal, with wildcard support such as `* -> FAULT` and `STARTING -> *`.
  - Illegal transitions are rejected centrally in `fsm.next(request, msg)` before any state mutation or accepted-event dispatch.
  - `dfsm-in` warns and shows red `illegal transition` status when the global rule check rejects a request.
  - Illegal transition rejections are emitted through the existing `dfsm-error` path.

### Fixed

- `dfsm-util-latch`: corrected editor/UI and documentation to match runtime behavior.
  - Node registration now uses one physical input (`inputs: 1`).
  - Removed incorrect multi-port labeling from editor metadata.
  - Help and README now consistently describe one physical input with three logical input types selected by `msg.topic` (`message`, `trigger`, `clear`).
- `dfsm-in`: `Allowable Previous States` now uses an FSM-backed multi-select list in the editor instead of freeform text.
  - Choices are populated from the selected FSM config node states.
  - Selections are preserved when possible when FSM config selection changes.
  - Selected values are stored as a JSON array; runtime keeps backward compatibility with legacy comma-separated values.

## [0.1.5] - 2026-04-15
