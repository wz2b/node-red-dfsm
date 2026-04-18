"use strict";

const {
  cloneValue,
  isPlainObject,
  makeErrorEvent,
  makeEventSnapshot,
  parseAllowedTransitions,
  parseInitialContext,
  parseStates,
  shallowMergeContext
} = require("./lib/fsm-utils");

module.exports = function(RED) {
  function DfsmConfigNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const eventSubscribers = new Set();
    const activeSubscribers = new Set();
    const enterSubscribers = new Set();
    const exitSubscribers = new Set();
    const errorSubscribers = new Set();

    let allowedStates;
    let allowedTransitions;
    let initialState;
    let initialContext;

    try {
      allowedStates = parseStates(config.states);

      if (allowedStates.length === 0) {
        throw new Error("At least one allowed state is required.");
      }

      initialState = typeof config.initialState === "string" ? config.initialState.trim() : "";

      if (!allowedStates.includes(initialState)) {
        throw new Error("Initial state must match one of the allowed states.");
      }

      allowedTransitions = parseAllowedTransitions(config.allowedTransitions, allowedStates);
      initialContext = parseInitialContext(config.initialContext);
    } catch (error) {
      node.status({ fill: "red", shape: "ring", text: "invalid config" });
      node.error(`Invalid FSM configuration: ${error.message}`);
      allowedStates = [];
      allowedTransitions = [];
      initialState = "";
      initialContext = {};
    }

    let currentState = initialState;
    let previousState = null;
    let context = cloneValue(initialContext);
    let eventId = 0;

    const intervalEnabled = config.intervalEnabled === true || config.intervalEnabled === "true";
    const parsedIntervalMs = Number.parseInt(config.intervalMs, 10);
    const intervalMs = Number.isFinite(parsedIntervalMs) && parsedIntervalMs > 0 ? parsedIntervalMs : 1000;
    const intervalPolicy = config.intervalPolicy === "queue_one" ? "queue_one" : "skip";
    const intervalMode = config.intervalMode === "fixed_delay" ? "fixed_delay" : "fixed_rate";

    let activeTimerHandle = null;
    let activeTimerKind = null;
    let currentActiveState = currentState;
    let inFlightUnresolved = false;
    let queuedIntervalEmission = false;

    function emitToSubscribers(subscribers, payload, msg) {
      subscribers.forEach((handler) => {
        try {
          handler(cloneValue(payload), msg);
        } catch (error) {
          node.warn(`FSM subscriber failed: ${error.message}`);
        }
      });
    }

    function publishError(details, msg) {
      const errorEvent = makeErrorEvent({
        type: details.type,
        message: details.message,
        requestedState: details.requestedState,
        currentState,
        validStates: allowedStates,
        originalRequest: details.originalRequest,
        ts: details.ts
      });

      emitToSubscribers(errorSubscribers, errorEvent, msg);
      return errorEvent;
    }

    function clearActiveTimer() {
      if (!activeTimerHandle) {
        return;
      }

      if (activeTimerKind === "interval") {
        clearInterval(activeTimerHandle);
      } else {
        clearTimeout(activeTimerHandle);
      }

      activeTimerHandle = null;
      activeTimerKind = null;
    }

    function buildActiveIntervalSnapshot() {
      const snapshot = makeEventSnapshot({
        state: currentState,
        prevState: currentState,
        changed: false,
        retrigger: false,
        context,
        eventId,
        timestamp: Date.now()
      });

      snapshot.lifecycleType = "active_interval";
      return snapshot;
    }

    function publishActiveLifecycle(snapshot, msg) {
      const lifecycleSnapshot = cloneValue(snapshot);

      if (!lifecycleSnapshot.lifecycleType) {
        lifecycleSnapshot.lifecycleType = "active_transition";
      }

      emitToSubscribers(activeSubscribers, lifecycleSnapshot, msg);
      currentActiveState = lifecycleSnapshot.state;
      inFlightUnresolved = true;
    }

    function onIntervalTick() {
      if (!intervalEnabled || !currentState) {
        return;
      }

      if (inFlightUnresolved) {
        if (intervalPolicy === "queue_one" && currentActiveState === currentState && !queuedIntervalEmission) {
          queuedIntervalEmission = true;
        }
        return;
      }

      if (intervalPolicy === "queue_one" && queuedIntervalEmission && currentActiveState === currentState) {
        queuedIntervalEmission = false;
      }

      publishActiveLifecycle(buildActiveIntervalSnapshot());
    }

    function ensureIntervalTimer() {
      if (!intervalEnabled || !currentState) {
        return;
      }

      if (intervalMode === "fixed_rate") {
        if (activeTimerHandle) {
          return;
        }

        activeTimerHandle = setInterval(onIntervalTick, intervalMs);
        activeTimerKind = "interval";
        return;
      }

      if (inFlightUnresolved || activeTimerHandle) {
        return;
      }

      activeTimerHandle = setTimeout(function() {
        activeTimerHandle = null;
        activeTimerKind = null;
        onIntervalTick();

        if (!inFlightUnresolved) {
          ensureIntervalTimer();
        }
      }, intervalMs);
      activeTimerKind = "timeout";
    }

    function clearActiveCycle(nextState) {
      const resolvedState = currentActiveState;
      const hadQueuedIntervalEmission = queuedIntervalEmission;

      currentActiveState = nextState;
      inFlightUnresolved = false;
      queuedIntervalEmission = false;

      if (intervalPolicy === "queue_one"
        && hadQueuedIntervalEmission
        && nextState === resolvedState
        && intervalEnabled
        && nextState) {
        // Emit one coalesced queued interval only when resolution keeps the same active state.
        publishActiveLifecycle(buildActiveIntervalSnapshot());
      }
    }

    function buildRuntimeSnapshot() {
      return {
        state: currentState,
        prevState: previousState,
        context: cloneValue(context),
        eventId,
        initialState,
        allowedStates: allowedStates.slice()
      };
    }

    node.getCurrentState = function() {
      return currentState;
    };

    node.getAllowedStates = function() {
      return allowedStates.slice();
    };

    node.getAllowedTransitions = function() {
      return cloneValue(allowedTransitions);
    };

    node.getContext = function() {
      return cloneValue(context);
    };

    node.getEventId = function() {
      return eventId;
    };

    node.getSnapshot = function() {
      return buildRuntimeSnapshot();
    };

    node.getIntervalSettings = function() {
      return {
        enabled: intervalEnabled,
        intervalMs,
        policy: intervalPolicy,
        mode: intervalMode
      };
    };

    node.subscribeEvents = function(handler) {
      eventSubscribers.add(handler);
      return function() {
        eventSubscribers.delete(handler);
      };
    };

    node.subscribeActiveLifecycle = function(handler) {
      activeSubscribers.add(handler);
      return function() {
        activeSubscribers.delete(handler);
      };
    };

    node.subscribeStateEnter = function(handler) {
      enterSubscribers.add(handler);
      return function() {
        enterSubscribers.delete(handler);
      };
    };

    node.subscribeStateExit = function(handler) {
      exitSubscribers.add(handler);
      return function() {
        exitSubscribers.delete(handler);
      };
    };

    node.subscribeErrors = function(handler) {
      errorSubscribers.add(handler);
      return function() {
        errorSubscribers.delete(handler);
      };
    };

    node.publishError = publishError;

    node.activationCompleted = function(request, msg) {
      if (!allowedStates.length) {
        const errorEvent = publishError({
          type: "invalid_configuration",
          message: "FSM configuration is invalid.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!isPlainObject(request)) {
        const errorEvent = publishError({
          type: "malformed_payload",
          message: "Completion request must be an object.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const requestedState = typeof request.nextState === "string" && request.nextState.trim()
        ? request.nextState.trim()
        : "";

      if (!requestedState) {
        const errorEvent = publishError({
          type: "missing_state",
          message: "A requested next state is required.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!allowedStates.includes(requestedState)) {
        const errorEvent = publishError({
          type: "invalid_state",
          message: `Requested state \"${requestedState}\" is not allowed.`,
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (requestedState !== currentState) {
        const errorEvent = publishError({
          type: "state_mismatch",
          message: `Activation completion requires same-state request \"${currentState}\" -> \"${currentState}\".`,
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const hasContextUpdate = Object.prototype.hasOwnProperty.call(request, "context");
      const replaceContext = request.replaceContext === true;

      if (hasContextUpdate && !isPlainObject(request.context)) {
        const errorEvent = publishError({
          type: "non_object_context",
          message: "Transition context must be a plain object.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (replaceContext && !hasContextUpdate) {
        const errorEvent = publishError({
          type: "missing_context",
          message: "replaceContext=true requires a context object.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (hasContextUpdate) {
        context = replaceContext
          ? cloneValue(request.context)
          : shallowMergeContext(context, request.context);
      }

      clearActiveCycle(currentState);
      ensureIntervalTimer();

      const completionEvent = {
        type: "activation_completed",
        state: currentState,
        prevState: previousState,
        changed: false,
        retrigger: false,
        completed: true,
        context: cloneValue(context),
        eventId,
        timestamp: Date.now()
      };

      return { ok: true, event: completionEvent };
    };

    node.updateContextOnly = function(request, msg) {
      if (!allowedStates.length) {
        const errorEvent = publishError({
          type: "invalid_configuration",
          message: "FSM configuration is invalid.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!isPlainObject(request)) {
        const errorEvent = publishError({
          type: "malformed_payload",
          message: "Context update request must be an object.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const hasContextUpdate = Object.prototype.hasOwnProperty.call(request, "context");
      const replaceContext = request.replaceContext === true;
      const requestedState = typeof request.state === "string" && request.state.trim()
        ? request.state.trim()
        : currentState;

      if (!requestedState) {
        const errorEvent = publishError({
          type: "missing_state",
          message: "A target state is required for context updates.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!allowedStates.includes(requestedState)) {
        const errorEvent = publishError({
          type: "invalid_state",
          message: `Requested state \"${requestedState}\" is not allowed.`,
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (requestedState !== currentState) {
        const errorEvent = publishError({
          type: "state_mismatch",
          message: `Cannot update context for \"${requestedState}\" while current state is \"${currentState}\".`,
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!hasContextUpdate) {
        const errorEvent = publishError({
          type: "missing_context",
          message: "msg.payload.context is required.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!isPlainObject(request.context)) {
        const errorEvent = publishError({
          type: "non_object_context",
          message: "Context update must be a plain object.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      context = replaceContext
        ? cloneValue(request.context)
        : shallowMergeContext(context, request.context);

      return {
        ok: true,
        event: {
          state: currentState,
          prevState: previousState,
          context: cloneValue(context),
          eventId,
          updatedAt: Date.now(),
          replaceContext
        }
      };
    };

    node.resetToInitialState = function() {
      clearActiveTimer();
      currentState = initialState;
      previousState = null;
      context = cloneValue(initialContext);
      eventId = 0;
      clearActiveCycle(currentState);
      ensureIntervalTimer();

      // TODO: Expose reset as an explicit user-visible node if it proves useful.
      return buildRuntimeSnapshot();
    };

    node.next = function(request, msg) {
      if (!allowedStates.length) {
        const errorEvent = publishError({
          type: "invalid_configuration",
          message: "FSM configuration is invalid.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!isPlainObject(request)) {
        const errorEvent = publishError({
          type: "malformed_payload",
          message: "Transition request must be an object.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const requestedState = typeof request.nextState === "string" && request.nextState.trim()
        ? request.nextState.trim()
        : "";

      if (!requestedState) {
        const errorEvent = publishError({
          type: "missing_state",
          message: "A requested next state is required.",
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (!allowedStates.includes(requestedState)) {
        const errorEvent = publishError({
          type: "invalid_state",
          message: `Requested state \"${requestedState}\" is not allowed.`,
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const hasContextUpdate = Object.prototype.hasOwnProperty.call(request, "context");
      const replaceContext = request.replaceContext === true;

      if (hasContextUpdate && !isPlainObject(request.context)) {
        const errorEvent = publishError({
          type: "non_object_context",
          message: "Transition context must be a plain object.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (replaceContext && !hasContextUpdate) {
        const errorEvent = publishError({
          type: "missing_context",
          message: "replaceContext=true requires a context object.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

      if (allowedTransitions.length > 0) {
        const isAllowedTransition = allowedTransitions.some((rule) => {
          return (rule.from === "*" || rule.from === currentState)
            && (rule.to === "*" || rule.to === requestedState);
        });

        if (!isAllowedTransition) {
          const errorEvent = publishError({
            type: "illegal_transition",
            message: `Illegal transition from \"${currentState}\" to \"${requestedState}\".`,
            requestedState,
            originalRequest: request
          }, msg);

          return { ok: false, error: errorEvent };
        }
      }

      const nextContext = hasContextUpdate
        ? (replaceContext
          ? cloneValue(request.context)
          : shallowMergeContext(context, request.context))
        : cloneValue(context);

      const nextPreviousState = currentState;
      const nextCurrentState = requestedState;
      const changed = nextCurrentState !== nextPreviousState;
      const retrigger = !changed;

      previousState = nextPreviousState;
      currentState = nextCurrentState;
      context = nextContext;
      eventId += 1;

      const snapshot = makeEventSnapshot({
        state: currentState,
        prevState: previousState,
        changed,
        retrigger,
        context,
        eventId,
        timestamp: Date.now()
      });

      node.status({ fill: changed ? "green" : "blue", shape: "dot", text: currentState || "idle" });

      // An accepted state-changing request is the only lifecycle resolution point.
      if (changed) {
        clearActiveCycle(currentState);
      }

      // Dispatch transition lifecycle notifications in exit-then-enter order for true state changes only.
      if (changed) {
        emitToSubscribers(exitSubscribers, snapshot, msg);
        emitToSubscribers(enterSubscribers, snapshot, msg);
      }

      emitToSubscribers(eventSubscribers, snapshot, msg);
      publishActiveLifecycle(snapshot, msg);
      ensureIntervalTimer();

      // TODO: Add allow/deny transition tables and persistence hooks.
      return { ok: true, event: snapshot };
    };

    node.status({ fill: "grey", shape: "ring", text: currentState || "unconfigured" });
    ensureIntervalTimer();

    node.on("close", function() {
      clearActiveTimer();
      eventSubscribers.clear();
      activeSubscribers.clear();
      enterSubscribers.clear();
      exitSubscribers.clear();
      errorSubscribers.clear();
      clearActiveCycle(currentState);
    });
  }

  RED.nodes.registerType("dfsm-state-machine", DfsmConfigNode);
};

