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

## [0.1.5] - 2026-04-15
