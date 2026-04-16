"use strict";

function initializeHelperRuntime(helper) {
  if (helper._RED && helper._redNodes && helper._comms && helper._context && helper._NodePrototype) {
    return;
  }

  const RED = require("node-red");

  helper._RED = RED;
  helper._log = RED.log;
  helper._settings = RED.settings;
  helper._events = RED.runtime.events;
  helper._redNodes = require("@node-red/runtime/lib/nodes");
  helper._context = require("@node-red/runtime/lib/nodes/context");
  helper._comms = require("@node-red/editor-api/lib/editor/comms");
  helper._registryUtil = require("@node-red/registry/lib/util");
  helper.credentials = require("@node-red/runtime/lib/nodes/credentials");
  helper._NodePrototype = require("@node-red/runtime/lib/nodes/Node").prototype;

  helper._nodeModules = {
    catch: require("@node-red/nodes/core/common/25-catch.js"),
    status: require("@node-red/nodes/core/common/25-status.js"),
    complete: require("@node-red/nodes/core/common/24-complete.js")
  };
}

module.exports = {
  initializeHelperRuntime
};

