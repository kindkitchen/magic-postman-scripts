"use strict";
(() => {
  // src/lib/lifecycle.ts
  function current_phase() {
    const event = pm.info?.eventName;
    if (event === "prerequest" || event === "test") return event;
    if (event !== void 0) {
      throw new Error(
        "MAGIC_ERROR: only HTTP prerequest/test events are supported"
      );
    }
    return pm.response ? "test" : "prerequest";
  }

  // src/guard_before_query.ts
  function guard_before_query() {
    const patterns = magic.guard?.env_name_like;
    if (patterns === void 0) return;
    const list = Array.isArray(patterns) ? patterns : [patterns];
    let matches = false;
    let invalid = false;
    try {
      const expressions = list.map((pattern) => {
        if (typeof pattern !== "string" && Object.prototype.toString.call(pattern) !== "[object RegExp]") {
          throw new Error("Invalid pattern");
        }
        return new RegExp(pattern);
      });
      matches = expressions.some(
        (expression) => expression.test(pm.environment.name ?? "")
      );
    } catch {
      invalid = true;
    }
    if (matches && !invalid) return;
    const reason = invalid ? "MAGIC_ERROR: invalid magic.guard.env_name_like pattern" : "MAGIC_ERROR: environment does not match magic.guard.env_name_like";
    if (current_phase() === "prerequest") {
      if (typeof pm.execution?.skipRequest !== "function") {
        throw new Error(
          reason + "; runtime lacks pm.execution.skipRequest(); request cancellation cannot be guaranteed"
        );
      }
      console.warn(reason);
      pm.execution.skipRequest();
    }
    throw new Error(reason);
  }

  // src/helpers/deep_merge.ts
  var unsafeKeys = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function is_record(value2) {
    if (value2 === null || typeof value2 !== "object" || Array.isArray(value2)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value2);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }
  function clone_value(value2) {
    if (Array.isArray(value2)) return value2.map(clone_value);
    if (is_record(value2)) {
      const result = {};
      for (const key2 of Object.keys(value2)) {
        if (unsafeKeys.has(key2)) throw new Error("Unsafe object key");
        result[key2] = clone_value(value2[key2]);
      }
      return result;
    }
    if (value2 !== null && typeof value2 === "object") {
      throw new Error("Expected JSON-compatible data");
    }
    if (value2 === void 0 || typeof value2 === "function" || typeof value2 === "symbol" || typeof value2 === "bigint" || typeof value2 === "number" && !Number.isFinite(value2)) {
      throw new Error("Expected JSON-compatible data");
    }
    return value2;
  }
  function merge_pair(previous2, incoming) {
    if (Array.isArray(previous2) && Array.isArray(incoming)) {
      return [...previous2, ...incoming];
    }
    if (is_record(previous2) && is_record(incoming)) {
      const result = { ...previous2 };
      for (const key2 of Object.keys(incoming)) {
        result[key2] = Object.prototype.hasOwnProperty.call(previous2, key2) ? merge_pair(previous2[key2], incoming[key2]) : incoming[key2];
      }
      return result;
    }
    return incoming;
  }
  function deep_merge(...objects) {
    return objects.reduce(
      (previous2, incoming) => merge_pair(previous2, clone_value(incoming)),
      {}
    );
  }

  // src/lib/values.ts
  function convert_value(value2, type) {
    if (type === "string") {
      return typeof value2 === "object" && value2 !== null ? JSON.stringify(clone_value(value2)) : String(clone_value(value2));
    }
    if (type === "number") {
      if (typeof value2 !== "number" && !(typeof value2 === "string" && value2.trim() !== ""))
        throw new Error("Expected a finite number or nonempty numeric string");
      const converted = Number(value2);
      if (!Number.isFinite(converted))
        throw new Error("Expected a finite number");
      return converted;
    }
    if (type === "boolean") {
      if (value2 === true || value2 === 1 || value2 === "true" || value2 === "1")
        return true;
      if (value2 === false || value2 === 0 || value2 === "false" || value2 === "0")
        return false;
      throw new Error("Expected a boolean, 0/1, or true/false string");
    }
    let parsed = value2;
    if (typeof value2 === "string") {
      try {
        parsed = JSON.parse(value2);
      } catch {
        throw new Error("Expected valid JSON for object/array conversion");
      }
    }
    if (type === "array" ? !Array.isArray(parsed) : !is_record(parsed)) {
      throw new Error(`Expected ${type}`);
    }
    return clone_value(parsed);
  }
  function previous_container(value2, type) {
    try {
      return convert_value(value2, type);
    } catch {
      return void 0;
    }
  }
  function serialize_value(value2) {
    return typeof value2 === "string" ? value2 : JSON.stringify(value2);
  }

  // src/lib/mapping.ts
  var types = ["string", "number", "boolean", "object", "array"];
  var strategies = ["replace", "propose", "merge", "deep-merge"];
  function mapping(configuration, source, destination, prefix = "") {
    if (configuration === void 0) return;
    if (!is_record(configuration)) throw new Error("Mapping must be an object");
    const errors = [];
    for (const [name, definition] of Object.entries(configuration)) {
      const key = prefix + name;
      let path = [];
      let stage = "validate mapping configuration";
      try {
        if (!Array.isArray(definition)) throw new Error();
        const parts = [...definition];
        const last = parts[parts.length - 1];
        const supplied = is_record(last) ? parts.pop() : {};
        if (!parts.every(
          (part) => typeof part === "string" || typeof part === "number" && Number.isInteger(part) && part >= 0
        ))
          throw new Error();
        path = parts;
        const options = {
          type: supplied.type ?? "string",
          strategy: supplied.strategy ?? "replace",
          magic: supplied.magic ?? null,
          on_missing: supplied.on_missing ?? "error"
        };
        if (!types.includes(options.type) || !strategies.includes(options.strategy) || !["error", "skip"].includes(options.on_missing) || options.magic !== null && typeof options.magic !== "string")
          throw new Error();
        const scope = pm[destination];
        stage = "read existing variable";
        const previous = scope.get(key);
        const exists = scope.has ? scope.has(key) : previous !== void 0 && previous !== null;
        if (options.strategy === "propose" && exists) {
          if (magic.debug)
            console.info(`MAGIC: keep ${destination}.${key} (propose)`);
          continue;
        }
        stage = "read path";
        let value = source;
        let missing = value === void 0;
        for (const part of path) {
          if (value === null || value === void 0 || !Object.prototype.hasOwnProperty.call(value, part)) {
            missing = true;
            break;
          }
          value = value[part];
          if (value === void 0) missing = true;
        }
        if (missing) {
          if (options.on_missing === "skip") {
            if (magic.debug)
              console.info(`MAGIC: skip ${destination}.${key} (missing path)`);
            continue;
          }
          stage = "read missing path";
          throw new Error();
        }
        if (options.magic !== null) {
          stage = "transform value (expected a synchronous function expression)";
          const transform = eval(`(${options.magic})`);
          if (typeof transform !== "function" || Object.prototype.toString.call(transform) === "[object AsyncFunction]")
            throw new Error();
          value = transform(value);
          if (value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function") {
            void Promise.resolve(value).catch(() => {
            });
            throw new Error();
          }
        }
        stage = `convert value to ${options.type} (expected JSON-compatible data)`;
        value = convert_value(value, options.type);
        if ((options.strategy === "merge" || options.strategy === "deep-merge") && (options.type === "object" || options.type === "array") && exists) {
          stage = "merge values";
          const oldValue = previous_container(previous, options.type);
          if (oldValue !== void 0) {
            if (options.strategy === "deep-merge") {
              value = deep_merge(oldValue, value);
            } else {
              value = options.type === "array" ? [...oldValue, ...value] : { ...oldValue, ...value };
            }
          }
        }
        stage = "save variable";
        scope.set(key, serialize_value(value));
        if (magic.debug) {
          console.info(
            `MAGIC: set ${destination}.${key} (${options.type}, ${options.strategy})`
          );
        }
      } catch {
        errors.push(
          `${destination}.${key} at ${JSON.stringify(path)}: unable to ${stage}`
        );
      }
    }
    if (errors.length) throw new Error("MAGIC_ERROR: " + errors.join("; "));
  }

  // src/test_after_response.ts
  var has_mappings = (groups) => groups.some(
    ([configuration2]) => configuration2 !== void 0 && (!is_record(configuration2) || Object.keys(configuration2).length > 0)
  );
  function test_after_response() {
    const name2 = magic.name || pm.info?.requestName || pm.request.name || "Magic Postman Scripts";
    pm.test(name2, () => {
      const resCodes = magic.res_codes ?? [200, 201, 202, 203, 204];
      const code = pm.response?.code || pm.response?.transport?.http?.statusCode;
      if (!Array.isArray(resCodes) || !resCodes.every(
        (value2) => Number.isInteger(value2) && value2 >= 100 && value2 <= 599
      ))
        throw new Error(
          "MAGIC_ERROR: res_codes must be an array of HTTP status codes"
        );
      if (!Number.isInteger(code) || !code || code < 100 || code > 599) {
        throw new Error("MAGIC_ERROR: missing or invalid response status code");
      }
      if (!resCodes.includes(code)) {
        throw new Error(
          `MAGIC_ERROR: response status ${code} is not allowed by res_codes`
        );
      }
      if (magic.prefix !== void 0 && typeof magic.prefix !== "string") {
        throw new Error("MAGIC_ERROR: prefix must be a string");
      }
      const failures = [];
      const prepared = [];
      const prepare = (label, groups, load) => {
        if (!has_mappings(groups)) return;
        let source2;
        try {
          source2 = load();
        } catch {
          failures.push(`Unable to read ${label} for configured mappings`);
          return;
        }
        prepared.push({ groups, source: source2 });
      };
      prepare(
        "response JSON",
        [
          [magic.res_jbody_to_env, "environment"],
          [magic.res_jbody_to_col, "collectionVariables"],
          [magic.res_jbody_to_globals, "globals"]
        ],
        () => {
          if (!pm.response) throw new Error();
          return pm.response.json();
        }
      );
      prepare(
        "request JSON",
        [
          [magic.req_jbody_to_env, "environment"],
          [magic.req_jbody_to_col, "collectionVariables"],
          [magic.req_jbody_to_globals, "globals"]
        ],
        () => {
          const body = pm.request.body;
          if (!body || body.mode !== void 0 && body.mode !== "raw")
            throw new Error();
          if (typeof body.raw !== "string") throw new Error();
          const raw = pm.variables ? pm.variables.replaceIn(body.raw) : body.raw;
          return JSON.parse(raw);
        }
      );
      prepare(
        "request form-data",
        [
          [magic.req_fbody_to_env, "environment"],
          [magic.req_fbody_to_col, "collectionVariables"],
          [magic.req_fbody_to_globals, "globals"]
        ],
        () => {
          const body = pm.request.body;
          if (!body || body.mode !== void 0 && body.mode !== "formdata")
            throw new Error();
          if (!body.formdata) throw new Error();
          return body.formdata.toObject();
        }
      );
      for (const { groups, source: source2 } of prepared) {
        for (const [configuration2, destination2] of groups) {
          try {
            mapping(configuration2, source2, destination2, magic.prefix);
          } catch (error) {
            failures.push(
              error instanceof Error ? error.message : "Unable to apply mapping"
            );
          }
        }
      }
      if (failures.length) throw new Error("MAGIC_ERROR: " + failures.join("; "));
    });
  }

  // src/index.ts
  var phase = current_phase();
  guard_before_query();
  if (phase === "test") test_after_response();
})();
