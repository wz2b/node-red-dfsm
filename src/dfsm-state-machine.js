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
    const completionSubscribers = new Set();
    const snapshotAttachedSubscribers = new Set();

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
    let lifecyclePhaseInFlight = null;
    let lifecycleTransitionInFlight = false;
    let lifecyclePhaseIdCounter = 0;

    function emitToSubscribers(subscribers, payload, msg) {
      subscribers.forEach((handler) => {
        try {
          handler(cloneValue(payload), msg);
        } catch (error) {
          node.warn(`FSM subscriber failed: ${error.message}`);
        }
      });
    }

    function normalizeLifecycleSubscription(handlerOrSubscription) {
      if (typeof handlerOrSubscription === "function") {
        return {
          handler: handlerOrSubscription,
          state: "",
          triggerOnSelfTransition: false,
          blocking: false
        };
      }

      if (handlerOrSubscription
        && typeof handlerOrSubscription.handler === "function") {
        return {
          handler: handlerOrSubscription.handler,
          state: typeof handlerOrSubscription.state === "string" ? handlerOrSubscription.state.trim() : "",
          triggerOnSelfTransition: handlerOrSubscription.triggerOnSelfTransition === true
            || handlerOrSubscription.triggerOnSelfTransition === "true",
          blocking: handlerOrSubscription.blocking === true || handlerOrSubscription.blocking === "true"
        };
      }

      return null;
    }

    function matchesLifecycleSubscription(subscription, phase, snapshot) {
      if (!subscription || typeof subscription.handler !== "function") {
        return false;
      }

      if (!subscription.state) {
        return true;
      }

      if (phase === "enter" && snapshot.state !== subscription.state) {
        return false;
      }

      if (phase === "exit" && snapshot.prevState !== subscription.state) {
        return false;
      }

      if (snapshot.retrigger && !subscription.triggerOnSelfTransition) {
        return false;
      }

      return true;
    }

    function completeLifecyclePhaseStep() {
      if (!lifecyclePhaseInFlight) {
        return false;
      }


      if (lifecyclePhaseInFlight.advancing === true) {
        return true;
      }

      lifecyclePhaseInFlight.advancing = true;

      const onComplete = lifecyclePhaseInFlight.onComplete;
      lifecyclePhaseInFlight = null;

      if (typeof onComplete === "function") {
        if (typeof queueMicrotask === "function") {
          queueMicrotask(onComplete);
        } else if (typeof setImmediate === "function") {
          setImmediate(onComplete);
        } else {
          setTimeout(onComplete, 0);
        }
      }

      return true;
    }

    function parseLifecyclePhaseIdFromMessage(msg) {
      const metadata = msg && isPlainObject(msg.dfsm) ? msg.dfsm : null;

      if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, "lifecyclePhaseId")) {
        return null;
      }

      const rawId = metadata.lifecyclePhaseId;

      if (Number.isInteger(rawId) && rawId > 0) {
        return rawId;
      }

      if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
        return Number.parseInt(rawId, 10);
      }

      return null;
    }

    function hasLifecyclePhaseHint(msg) {
      const metadata = msg && isPlainObject(msg.dfsm) ? msg.dfsm : null;

      if (!metadata) {
        return false;
      }

      return Object.prototype.hasOwnProperty.call(metadata, "lifecyclePhaseId")
        || Object.prototype.hasOwnProperty.call(metadata, "lifecyclePhase");
    }

    function dispatchLifecyclePhase(phase, subscribers, snapshot, msg, onComplete) {
      const matchingSubscribers = Array.from(subscribers)
        .filter((subscription) => matchesLifecycleSubscription(subscription, phase, snapshot));

      const blockingSubscribers = matchingSubscribers
        .filter((subscription) => subscription.blocking === true);
      const observerSubscribers = matchingSubscribers
        .filter((subscription) => subscription.blocking !== true);

      if (matchingSubscribers.length === 0) {
        onComplete();
        return;
      }

      const phaseId = lifecyclePhaseIdCounter + 1;
      lifecyclePhaseIdCounter = phaseId;

      const phaseSnapshot = cloneValue(snapshot);
      phaseSnapshot.lifecyclePhase = phase;
      phaseSnapshot.lifecyclePhaseId = phaseId;
      phaseSnapshot.fromState = snapshot.prevState;
      phaseSnapshot.toState = snapshot.state;
      phaseSnapshot.lifecyclePhaseState = phase === "exit" ? snapshot.prevState : snapshot.state;

      if (blockingSubscribers.length > 1) {
        publishError({
          type: "lifecycle_blocking_ambiguous",
          message: `Lifecycle ${phase.toUpperCase()} has ${blockingSubscribers.length} matching blocking handlers; exactly one is allowed.`,
          requestedState: snapshot.state,
          originalRequest: {
            lifecyclePhase: phase,
            lifecyclePhaseId: phaseId,
            phaseState: phaseSnapshot.lifecyclePhaseState,
            fromState: snapshot.prevState,
            toState: snapshot.state,
            blockingSubscriberCount: blockingSubscribers.length
          }
        }, msg);

        node.warn(`Lifecycle ${phase} rejected: ${blockingSubscribers.length} matching blocking handlers for ${snapshot.prevState} -> ${snapshot.state}.`);
        lifecyclePhaseInFlight = null;
        lifecycleTransitionInFlight = false;
        return;
      }

      if (blockingSubscribers.length === 1) {
        const blockingSubscriber = blockingSubscribers[0];

        lifecyclePhaseInFlight = {
          id: phaseId,
          type: phase,
          phaseState: phaseSnapshot.lifecyclePhaseState,
          fromState: snapshot.prevState,
          toState: snapshot.state,
          onComplete,
          advancing: false
        };

        observerSubscribers.forEach((subscription) => {
          try {
            subscription.handler(cloneValue(phaseSnapshot), msg);
          } catch (error) {
            node.warn(`FSM ${phase} subscriber failed: ${error.message}`);
          }
        });

        try {
          blockingSubscriber.handler(cloneValue(phaseSnapshot), msg);
        } catch (error) {
          node.warn(`FSM ${phase} subscriber failed: ${error.message}`);
          completeLifecyclePhaseStep();
        }

        return;
      }

      observerSubscribers.forEach((subscription) => {
        try {
          subscription.handler(cloneValue(phaseSnapshot), msg);
        } catch (error) {
          node.warn(`FSM ${phase} subscriber failed: ${error.message}`);
        }
      });

      onComplete();
    }

    function dispatchTransitionLifecycle(snapshot, msg) {
      lifecycleTransitionInFlight = true;

      dispatchLifecyclePhase("exit", exitSubscribers, snapshot, msg, function() {
        dispatchLifecyclePhase("enter", enterSubscribers, snapshot, msg, function() {
          const activeSnapshot = makeEventSnapshot({
            state: currentState,
            prevState: previousState,
            changed: currentState !== previousState,
            retrigger: false,
            context,
            eventId,
            timestamp: Date.now()
          });

          publishActiveLifecycle(activeSnapshot, msg);
          ensureIntervalTimer();
          lifecycleTransitionInFlight = false;
        });
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
      const subscription = normalizeLifecycleSubscription(handler);
      if (!subscription) {
        throw new Error("subscribeStateEnter requires a handler function.");
      }

      enterSubscribers.add(subscription);
      return function() {
        enterSubscribers.delete(subscription);
      };
    };

    node.subscribeStateExit = function(handler) {
      const subscription = normalizeLifecycleSubscription(handler);
      if (!subscription) {
        throw new Error("subscribeStateExit requires a handler function.");
      }

      exitSubscribers.add(subscription);
      return function() {
        exitSubscribers.delete(subscription);
      };
    };

    node.subscribeErrors = function(handler) {
      errorSubscribers.add(handler);
      return function() {
        errorSubscribers.delete(handler);
      };
    };

    node.publishError = publishError;

    node.completeLifecycleStep = function(msg) {
      if (!allowedStates.length) {
        const errorEvent = publishError({
          type: "invalid_configuration",
          message: "FSM configuration is invalid.",
          originalRequest: null
        }, msg);

        return { ok: false, error: errorEvent };
      }

      const completionPhaseId = parseLifecyclePhaseIdFromMessage(msg);
      const completionHasPhaseHint = hasLifecyclePhaseHint(msg);
      const completionPhase = msg && isPlainObject(msg.dfsm) && typeof msg.dfsm.lifecyclePhase === "string"
        ? msg.dfsm.lifecyclePhase.trim()
        : "";

      if (lifecyclePhaseInFlight
        && (lifecyclePhaseInFlight.type === "exit" || lifecyclePhaseInFlight.type === "enter")) {
        const inFlightPhase = lifecyclePhaseInFlight;
        const hasPhaseIdHint = completionPhaseId !== null;
        const hasPhaseTypeHint = completionPhase !== "";
        const isPhaseIdMismatch = hasPhaseIdHint && completionPhaseId !== inFlightPhase.id;
        const isPhaseTypeMismatch = hasPhaseTypeHint && completionPhase !== inFlightPhase.type;

        if (isPhaseIdMismatch || isPhaseTypeMismatch) {
          const errorEvent = publishError({
            type: "lifecycle_phase_mismatch",
            message: `Completion metadata does not match in-flight lifecycle ${inFlightPhase.type} phase ${inFlightPhase.id}.`,
            originalRequest: {
              lifecyclePhase: completionPhase || null,
              lifecyclePhaseId: completionPhaseId,
              expectedLifecyclePhase: inFlightPhase.type,
              expectedLifecyclePhaseId: inFlightPhase.id
            }
          }, msg);

          node.warn(`Lifecycle completion rejected: metadata mismatch for in-flight ${inFlightPhase.type} phase ${inFlightPhase.id}.`);
          return { ok: false, error: errorEvent };
        }

        const phase = inFlightPhase;
        const completed = completeLifecyclePhaseStep();

        if (!completed) {
          const errorEvent = publishError({
            type: "lifecycle_not_in_flight",
            message: "No lifecycle phase is waiting for completion.",
            originalRequest: null
          }, msg);

          return { ok: false, error: errorEvent };
        }

        const completionEvent = {
          type: "activation_completed",
          traceType: "activation-complete",
          lifecyclePhase: phase.type,
          lifecyclePhaseId: phase.id,
          phaseState: phase.phaseState,
          fromState: phase.fromState,
          toState: phase.toState,
          state: currentState,
          prevState: previousState,
          changed: false,
          retrigger: false,
          completed: true,
          context: cloneValue(context),
          eventId,
          timestamp: Date.now(),
          message: phase.type === "exit"
            ? `LIFECYCLE EXIT COMPLETE from ${phase.fromState} to ${phase.toState}`
            : `LIFECYCLE ENTER COMPLETE into ${phase.toState} from ${phase.fromState}`
        };

        emitToSubscribers(completionSubscribers, completionEvent, msg);
        return { ok: true, event: completionEvent };
      }

      if (completionHasPhaseHint) {
        const errorEvent = publishError({
          type: "lifecycle_not_in_flight",
          message: "No matching lifecycle phase is currently in flight for this completion.",
          originalRequest: {
            lifecyclePhase: completionPhase || null,
            lifecyclePhaseId: completionPhaseId
          }
        }, msg);

        node.warn(`Lifecycle completion rejected: no in-flight phase for id ${completionPhaseId || "(none)"}.`);
        return { ok: false, error: errorEvent };
      }

      clearActiveCycle(currentState);
      ensureIntervalTimer();

      const completionEvent = {
        type: "activation_completed",
        traceType: "activation-complete",
        state: currentState,
        prevState: previousState,
        changed: false,
        retrigger: false,
        completed: true,
        context: cloneValue(context),
        eventId,
        timestamp: Date.now(),
        message: `ACTIVATION COMPLETE for state ${currentState}`
      };

      emitToSubscribers(completionSubscribers, completionEvent, msg);

      return { ok: true, event: completionEvent };
    };

    node.subscribeCompletionEvents = function(handler) {
      completionSubscribers.add(handler);
      return function() {
        completionSubscribers.delete(handler);
      };
    };

    node.subscribeSnapshotAttached = function(handler) {
      snapshotAttachedSubscribers.add(handler);
      return function() {
        snapshotAttachedSubscribers.delete(handler);
      };
    };

    node.publishSnapshotAttached = function(traceEvent, msg) {
      emitToSubscribers(snapshotAttachedSubscribers, traceEvent, msg);
    };

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
          message: "A context object is required (canonical: msg.dfsm.context; legacy: msg.payload.context).",
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

      if (changed && (lifecycleTransitionInFlight || lifecyclePhaseInFlight)) {
        const errorEvent = publishError({
          type: "lifecycle_busy",
          message: "Transition lifecycle is still in flight.",
          requestedState,
          originalRequest: request
        }, msg);

        return { ok: false, error: errorEvent };
      }

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

      emitToSubscribers(eventSubscribers, snapshot, msg);

      if (changed) {
        dispatchTransitionLifecycle(snapshot, msg);
      } else {
        publishActiveLifecycle(snapshot, msg);
        ensureIntervalTimer();
      }

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
      completionSubscribers.clear();
      snapshotAttachedSubscribers.clear();
      clearActiveCycle(currentState);
    });
  }

  RED.nodes.registerType("dfsm-state-machine", DfsmConfigNode);
};

