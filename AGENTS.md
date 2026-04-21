# AGENTS.md

Guidance for AI coding agents and contributors working on this project.

## Project Intent

This project implements a discrete finite state machine framework for Node-RED.

The goal is to make state-machine behavior explicit, readable, and maintainable in Node-RED flows. The design is inspired by formal FSM / SFC / PLC-style thinking, but it runs in Node-RED and must follow Node-RED conventions and expectations.

Favor clarity, explicitness, and predictable behavior over cleverness.

---

## Naming and Node Conventions

- All node names in this project should use the `dfsm-*` prefix.
- Follow existing naming conventions unless there is a strong reason to change them.
- Prefer names that describe the node's role in the FSM model clearly and consistently.
- Do not introduce alternate naming patterns for similar concepts without a compelling reason.
- Keep terminology consistent across:
    - runtime code
    - editor UI
    - help text
    - README
    - examples
    - tests

---

## Architectural Principles

- Preserve the core purpose of the project: explicit FSM structure in Node-RED.
- Prefer explicit message flow over hidden behavior.
- Do not solve problems by introducing unnecessary hidden state, implicit coupling, or magical behavior.
- Avoid designs that obscure how a flow behaves when viewed on the Node-RED canvas.
- Keep the model understandable to someone reading the flow visually.
- Do not solve FSM design problems by pushing more logic into opaque context or internal state if it makes the
  flow less visually understandable.
- Prefer small, focused nodes with a clear purpose.
- Do not turn a node into a multi-purpose tool by layering on loosely related modes or configuration options.
- If a node starts to serve multiple distinct roles, consider splitting that behavior into separate nodes instead.

When making design choices, prefer:
1. explicit semantics
2. predictable behavior
3. readability in the editor
4. backward compatibility

If breaking changes are introduced, they must be clearly marked in `CHANGELOG.md`.

---

## Behavior and Semantics

- Do not silently change node semantics.
- If a node’s behavior changes in a meaningful way, update:
    - unit tests
    - README
    - help text
    - examples, if applicable
    - CHANGELOG.md
- Preserve backward compatibility unless the requested change explicitly breaks it.
- If a breaking change is necessary, document it clearly and update the changelog accordingly.
- Do not invent new runtime semantics unless they are clearly justified by the project’s design.

Examples of semantics that must be treated carefully:
- retrigger behavior
- transition filtering
- state entry / exit / active lifecycle behavior
- context merge / patch semantics
- queueing or activation ordering
- handling of same-state transitions
- event payload structure

---

## Node-RED File Structure Expectations

For every Node-RED node, keep the implementation aligned across all required artifacts:

- runtime JavaScript / TypeScript
- editor `.html`
- help text
- tests
- README documentation

If a node gains or changes:
- inputs
- outputs
- configuration properties
- status behavior
- emitted message structure
- purpose or intended usage

then all corresponding files must be updated together.

Do not leave the runtime, editor UI, README, and tests out of sync.

---

## Testing Requirements

- Create unit tests for every new feature.
- Create unit tests for edge cases and failure cases, not just happy paths.
- Do not modify or weaken existing tests merely to make them pass.
- If an existing test fails, first assume the implementation may be wrong.
- Only change an existing test if the prior expectation is genuinely incorrect or the intended behavior has explicitly changed.
- New behavior should include tests for:
    - expected success cases
    - invalid input
    - boundary conditions
    - backward compatibility where relevant
    - message shape / payload correctness
    - state-machine edge cases

When fixing bugs:
- add or update a test that demonstrates the bug
- then fix the implementation

---

## Documentation Requirements

- All changes to nodes, including inputs, outputs, configuration, and purpose, must be reflected in `README.md`.
- All significant changes must be added to `CHANGELOG.md` using the format already established in that file.
- If a new feature changes how a user should build flows, document the recommended usage pattern.
- If a feature has non-obvious semantics, document them explicitly.
- Keep examples aligned with current behavior.
- Do not allow the README to drift behind the code.

If you change:
- node names
- lifecycle behavior
- retrigger behavior
- filtering logic
- context handling
- message contract
- example flows

then update the README in the same change.

---

## CHANGELOG Discipline

- Significant user-visible changes must be recorded in `CHANGELOG.md`.
- Follow the existing changelog format exactly.
- Do not batch unrelated changes into a vague entry.
- Prefer specific entries that describe what changed and why it matters to users.
- If behavior changes, note whether it is:
    - a fix
    - a new feature
    - a behavioral clarification
    - a breaking change

---

## Examples and Usability

- Favor example flows that demonstrate realistic FSM usage.
- Examples should help users understand:
    - why the node exists
    - when to use it
    - what messages flow through it
    - how states, transitions, and activations behave
- Do not create toy examples that obscure real usage.
- Keep examples small enough to understand, but realistic enough to teach.

---

## Editor and UX Expectations

- Node labels, help text, placeholders, and config labels should be clear and consistent.
- Prefer straightforward language over jargon unless the concept is inherently technical.
- Keep the editor experience aligned with Node-RED norms.
- Do not add configuration options unless they are truly needed.
- Avoid cluttering nodes with poorly justified options.

When adding options:
- make sure their behavior is clearly defined
- make sure they are documented
- make sure they are tested
- make sure the default behavior is sensible and backward compatible

---

## Code Quality Expectations

- Follow the existing project style and structure.
- Keep changes focused and minimal.
- Do not perform broad refactors unless they are necessary for the task.
- Avoid gratuitous renaming or file reorganization.
- Prefer small, understandable functions over overly abstract code.
- Avoid premature generalization.
- Keep message contracts and state transitions easy to trace.

---

## TypeScript and Implementation Guidance

- Preserve or improve type safety where possible.
- Do not bypass typing with `any` unless there is a strong reason.
- Prefer explicit types for public interfaces, message contracts, and internal event structures.
- Keep private/internal implementation details clearly separated from node-facing behavior.
- If adding new event or payload shapes, define them cleanly and test them thoroughly.

---

## Backward Compatibility

- Existing flows should continue to work unless a breaking change is explicitly intended.
- Default behavior should remain stable whenever possible.
- New options should default to behavior compatible with prior releases unless otherwise requested.
- Be cautious when changing emitted message shapes, property names, or timing/ordering semantics.

---

## What to Avoid

- Do not introduce hidden magic.
- Do not silently change semantics.
- Do not modify tests just to force a green build.
- Do not leave documentation behind.
- Do not introduce inconsistent naming.
- Do not add config options without clear purpose and tests.
- Do not optimize for cleverness at the expense of readability.
- Do not break existing flows casually.

---

## Preferred Contributor Workflow

For any significant change:

1. Understand the current behavior first.
2. Make the smallest coherent implementation change.
3. Add or update tests for the intended behavior.
4. Update README.md.
5. Update CHANGELOG.md if user-visible.
6. Verify editor/runtime/help text consistency.
7. Confirm examples still make sense.

---

## Release and Versioning Notes

- Remember to update `CHANGELOG.md` for significant changes.
- Be aware that versioning and publishing are handled deliberately and manually.
- Do not assume release steps are automatic.
- Do not make casual version bumps unless explicitly asked.

---

## If Unsure

If a requested change creates ambiguity around semantics, favor the interpretation that is:

- most explicit
- most readable in Node-RED flows
- most backward compatible
- easiest to document and test