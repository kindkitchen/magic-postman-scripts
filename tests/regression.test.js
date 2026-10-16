import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildBundle } from "../scripts/build.js";
import { createHarness } from "./harness.js";

const source = buildBundle();
const committed = fs.readFileSync(
  path.join(import.meta.dirname, "../magic-postman-scripts.js"),
  "utf8",
);

it("the committed bundle matches the source build", () => {
  assert.equal(committed, source, "Run yarn build after editing the source");
  assert.doesNotMatch(committed, /require\(|module\.exports|sourceMappingURL/);
});

it("imports the ESM build helper without running the build CLI", () => {
  const buildUrl = new URL("../scripts/build.js", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(buildUrl.href)})`,
    ],
    { cwd: os.tmpdir(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

it("runs the ESM build CLI from outside the repository", () => {
  const buildPath = fileURLToPath(
    new URL("../scripts/build.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [buildPath, "--check"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Copy-paste bundle is up to date/);
});

for (const [implementation, script] of [
  ["source", source],
  ["copy-paste bundle", committed],
]) {
  describe(implementation, () => {
    function run(configuration = {}, options = {}) {
      const harness = createHarness(configuration, options);
      harness.run(script);
      return harness;
    }
    function passed(harness) {
      assert.equal(harness.tests.length, 1);
      assert.equal(harness.tests[0].passed, true, harness.tests[0].error);
    }
    function failed(harness, message) {
      assert.equal(harness.tests.length, 1);
      assert.equal(harness.tests[0].passed, false);
      if (message) assert.match(harness.tests[0].error, message);
    }
    const envValue = (harness, key = "value") =>
      harness.get("environment", key);
    const config = (options = {}) => ({
      res_jbody_to_env: { value: ["value", options] },
    });

    it("validates the default success codes without reading unused bodies", () => {
      for (const code of [200, 201, 202, 203, 204]) {
        const h = run({}, { code, nonJsonResponse: true });
        passed(h);
        assert.equal(h.responseReads, 0);
        assert.equal(h.requestReplacements, 0);
      }
    });

    it("supports lexical magic configurations used with eval in Postman", () => {
      const h = createHarness();
      delete h.context.magic;
      h.run(
        `const magic = { res_codes: [200] }; eval(${JSON.stringify(script)});`,
      );
      passed(h);
    });

    it("maps response data to all scopes with a prefix and custom test name", () => {
      const mapping = { id: ["data", "id"] };
      const h = run(
        {
          name: "Create",
          prefix: "order_",
          res_codes: [201],
          res_jbody_to_env: mapping,
          res_jbody_to_col: mapping,
          res_jbody_to_globals: mapping,
        },
        { code: 201, responseBody: { data: { id: 42 } } },
      );
      passed(h);
      assert.equal(h.tests[0].name, "Create");
      for (const scope of ["environment", "collectionVariables", "globals"])
        assert.equal(h.get(scope, "order_id"), "42");
      assert.equal(h.writes.length, 3);
      assert.deepEqual(mapping, { id: ["data", "id"] });
    });

    it("supports raw request JSON mappings in every scope and resolves variables once", () => {
      const mapping = { value: ["value", { type: "number" }] };
      const h = run(
        {
          req_jbody_to_env: mapping,
          req_jbody_to_col: mapping,
          req_jbody_to_globals: mapping,
        },
        {
          request: { body: { mode: "raw", raw: '{"value":{{amount}}}' } },
          variables: { amount: "12" },
          nonJsonResponse: true,
        },
      );
      passed(h);
      for (const scope of ["environment", "collectionVariables", "globals"])
        assert.equal(h.get(scope, "value"), "12");
      assert.equal(h.requestReplacements, 1);
      assert.equal(h.responseReads, 0);
    });

    it("snapshots request JSON before response mappings overwrite template variables", () => {
      const h = createHarness(
        {
          res_jbody_to_col: { amount: ["value"] },
          req_jbody_to_env: { amount: ["value"] },
        },
        {
          initial: { collectionVariables: { amount: "12" } },
          responseBody: { value: 20 },
          request: { body: { raw: '{"value":{{amount}}}' } },
        },
      );
      h.pm.variables.replaceIn = () =>
        JSON.stringify({
          value: Number(h.get("collectionVariables", "amount")),
        });
      h.run(script);
      passed(h);
      assert.equal(h.get("collectionVariables", "amount"), "20");
      assert.equal(envValue(h, "amount"), "12");
    });

    it("works without a replaceIn API when the body is already JSON", () => {
      const h = run(
        { req_jbody_to_env: { value: ["value"] } },
        { noVariables: true, request: { body: { raw: '{"value":7}' } } },
      );
      passed(h);
      assert.equal(envValue(h), "7");
    });

    it("maps form-data to all scopes", () => {
      const mapping = { value: ["value"] };
      const h = run(
        {
          req_fbody_to_env: mapping,
          req_fbody_to_col: mapping,
          req_fbody_to_globals: mapping,
        },
        {
          request: {
            body: {
              mode: "formdata",
              formdata: { toObject: () => ({ value: "form" }) },
            },
          },
        },
      );
      passed(h);
      for (const scope of ["environment", "collectionVariables", "globals"])
        assert.equal(h.get(scope, "value"), "form");
      assert.equal(h.requestReplacements, 0);
    });

    it("does not parse a plain-text request for response-only mappings", () => {
      const h = run(config(), {
        responseBody: { value: 7 },
        request: { body: { mode: "raw", raw: "not JSON" } },
      });
      passed(h);
      assert.equal(envValue(h), "7");
    });

    it("does not need any request body for response-only mappings", () => {
      const h = run(config(), { responseBody: { value: "ok" }, request: {} });
      passed(h);
      assert.equal(envValue(h), "ok");
    });

    it("keeps mapping options and transformations across repeated executions", () => {
      const options = Object.freeze({
        type: "number",
        magic: "value => value * 2",
      });
      const mapping = Object.freeze({
        value: Object.freeze(["value", options]),
      });
      const h = run(
        { res_jbody_to_env: mapping },
        { responseBody: { value: 3 } },
      );
      passed(h);
      h.run(script);
      assert.equal(h.tests.length, 2);
      assert.ok(h.tests.every((test) => test.passed));
      assert.equal(envValue(h), "6");
      assert.equal(mapping.value.length, 2);
    });

    it("supports function expressions as well as arrows", () => {
      const h = run(
        config({
          magic: "function (value) { return value + 1; }",
          type: "number",
        }),
        { responseBody: { value: 3 } },
      );
      passed(h);
      assert.equal(envValue(h), "4");
    });

    it("propose preserves existing false, zero, empty string, and null without writing", () => {
      for (const value of [false, 0, "", null, "false", "0"]) {
        const h = run(
          config({
            strategy: "propose",
            magic: "() => { throw new Error('must not run'); }",
          }),
          { initial: { environment: { value } } },
        );
        passed(h);
        assert.equal(envValue(h), value);
        assert.equal(h.writes.length, 0);
      }
    });

    it("propose saves a new variable and works without has()", () => {
      const h = run(config({ strategy: "propose" }), {
        responseBody: { value: "new" },
        noHas: true,
      });
      passed(h);
      assert.equal(envValue(h), "new");
      const existing = run(config({ strategy: "propose" }), {
        noHas: true,
        initial: { environment: { value: false } },
      });
      passed(existing);
      assert.equal(envValue(existing), false);
    });

    it("supports empty/root paths, numeric indices, and empty-string property names", () => {
      const h = run(
        {
          res_jbody_to_env: {
            root: [{ type: "object" }],
            first: ["items", 0, "id"],
            empty: [""],
          },
        },
        { responseBody: { items: [{ id: "one" }], "": "empty key" } },
      );
      passed(h);
      assert.deepEqual(JSON.parse(envValue(h, "root")), {
        items: [{ id: "one" }],
        "": "empty key",
      });
      assert.equal(envValue(h, "first"), "one");
      assert.equal(envValue(h, "empty"), "empty key");
      const rootArray = run(
        { res_jbody_to_env: { value: [] } },
        { responseBody: [1, 2] },
      );
      passed(rootArray);
      assert.equal(envValue(rootArray), "[1,2]");
    });

    it("reports missing fields but still maps subsequent variables and scopes", () => {
      const h = run(
        {
          res_jbody_to_env: { missing: ["data", "id"], value: ["value"] },
          res_jbody_to_col: { also: ["value"] },
        },
        { responseBody: { value: "ok" } },
      );
      failed(
        h,
        /environment\.missing at \["data","id"\]: unable to read missing path/,
      );
      assert.equal(envValue(h), "ok");
      assert.equal(h.get("collectionVariables", "also"), "ok");
    });

    it("can skip missing paths without overwriting existing values", () => {
      const h = run(config({ on_missing: "skip" }), {
        initial: { environment: { value: "keep" } },
      });
      passed(h);
      assert.equal(envValue(h), "keep");
      assert.equal(h.writes.length, 0);
    });

    it("treats null as a value and does not traverse inherited properties", () => {
      const h = run(config(), { responseBody: { value: null } });
      passed(h);
      assert.equal(envValue(h), "null");
      const inherited = run({ res_jbody_to_env: { value: ["toString"] } });
      failed(inherited, /missing path/);
      assert.equal(inherited.writes.length, 0);
    });

    it("applies trailing options to the selected value, not to a path segment", () => {
      const body = {
        order: { lines: [{ quantity: "0042" }], type: "wholesale" },
      };
      const h = run(
        {
          res_jbody_to_env: {
            first_quantity: [
              "order",
              "lines",
              0,
              "quantity",
              { type: "number" },
            ],
            order_type: ["order", "type"],
          },
        },
        { responseBody: body },
      );
      passed(h);
      assert.equal(envValue(h, "first_quantity"), "42");
      assert.equal(envValue(h, "order_type"), "wholesale");
      assert.equal(body.order.lines[0].quantity, "0042");
      const misplaced = run(
        {
          res_jbody_to_env: {
            value: ["order", { type: "number" }, "quantity"],
          },
        },
        { responseBody: body },
      );
      failed(misplaced, /validate mapping configuration/);
      assert.equal(misplaced.writes.length, 0);
    });

    it("stores the documented default string conversions as text", () => {
      for (const [value, expected] of [
        ["hello", "hello"],
        ["0042", "0042"],
        [42, "42"],
        [false, "false"],
        [null, "null"],
        [{ id: 42 }, '{"id":42}'],
        [["a", "b"], '["a","b"]'],
      ]) {
        const h = run(config(), { responseBody: { value } });
        passed(h);
        assert.equal(envValue(h), expected);
        assert.equal(typeof envValue(h), "string");
      }
    });

    it("converts numbers and booleans explicitly", () => {
      for (const value of [0, 12, " 12 ", "1e2"]) {
        const h = run(config({ type: "number" }), { responseBody: { value } });
        passed(h);
        assert.equal(envValue(h), String(Number(value)));
      }
      for (const [value, expected] of [
        [true, "true"],
        [false, "false"],
        [0, "false"],
        [1, "true"],
        ["false", "false"],
        ["true", "true"],
        ["0", "false"],
        ["1", "true"],
      ]) {
        const h = run(config({ type: "boolean" }), { responseBody: { value } });
        passed(h);
        assert.equal(envValue(h), expected);
      }
    });

    it("rejects ambiguous conversions without overwriting the destination", () => {
      for (const [type, values] of [
        ["number", [null, true, "", " ", "NaN", Infinity]],
        ["boolean", [null, "yes", 2, "False"]],
        ["object", [null, [], "[]", "bad"]],
        ["array", [{}, "{}", "bad"]],
      ]) {
        for (const value of values) {
          const h = run(config({ type }), {
            responseBody: { value },
            initial: { environment: { value: "keep" } },
          });
          failed(h, /convert value/);
          assert.equal(envValue(h), "keep");
          assert.equal(h.writes.length, 0);
        }
      }
    });

    it("serializes objects and arrays and accepts JSON strings for typed containers", () => {
      for (const [type, value, expected] of [
        ["object", { a: 1 }, '{"a":1}'],
        ["object", '{"a":1}', '{"a":1}'],
        ["array", [1, [2]], "[1,[2]]"],
        ["array", "[1,[2]]", "[1,[2]]"],
        ["string", { a: 1 }, '{"a":1}'],
      ]) {
        const h = run(config({ type }), { responseBody: { value } });
        passed(h);
        assert.equal(envValue(h), expected);
      }
    });

    it("shallow-merges stored JSON objects and replaces nested keys", () => {
      const h = run(config({ type: "object", strategy: "merge" }), {
        responseBody: { value: { nested: { fresh: 2 }, added: true } },
        initial: { environment: { value: '{"old":1,"nested":{"old":1}}' } },
      });
      passed(h);
      assert.deepEqual(JSON.parse(envValue(h)), {
        old: 1,
        nested: { fresh: 2 },
        added: true,
      });
    });

    it("deep-merges stored JSON objects and preserves nested arrays", () => {
      const body = {
        value: {
          nested: { fresh: 2 },
          items: [[2, 3]],
          mismatch: { fresh: true },
        },
      };
      const h = run(config({ type: "object", strategy: "deep-merge" }), {
        responseBody: body,
        initial: {
          environment: {
            value: '{"old":1,"nested":{"old":1},"items":[[1]],"mismatch":[0]}',
          },
        },
      });
      passed(h);
      assert.deepEqual(JSON.parse(envValue(h)), {
        old: 1,
        nested: { old: 1, fresh: 2 },
        items: [[1], [2, 3]],
        mismatch: { fresh: true },
      });
      assert.deepEqual(body, {
        value: {
          nested: { fresh: 2 },
          items: [[2, 3]],
          mismatch: { fresh: true },
        },
      });
    });

    it("concatenates root arrays without flattening for either merge strategy", () => {
      for (const strategy of ["merge", "deep-merge"]) {
        const h = run(config({ type: "array", strategy }), {
          responseBody: { value: [[2, 3]] },
          initial: { environment: { value: "[[1]]" } },
        });
        passed(h);
        assert.deepEqual(JSON.parse(envValue(h)), [[1], [2, 3]]);
      }
    });

    it("replaces malformed/wrong-type previous containers instead of spreading strings", () => {
      for (const [type, value, previous] of [
        ["object", { fresh: true }, "old"],
        ["object", { fresh: true }, "[]"],
        ["array", [2], "{}"],
        ["object", { fresh: true }, 42],
        ["array", [2], null],
      ]) {
        for (const strategy of ["merge", "deep-merge"]) {
          const h = run(config({ type, strategy }), {
            responseBody: { value },
            initial: { environment: { value: previous } },
          });
          passed(h);
          assert.deepEqual(JSON.parse(envValue(h)), value);
        }
      }
    });

    it("uses replacement for primitive merge strategies", () => {
      const h = run(config({ type: "number", strategy: "merge" }), {
        responseBody: { value: 2 },
        initial: { environment: { value: "1" } },
      });
      passed(h);
      assert.equal(envValue(h), "2");
    });

    it("rejects unsafe JSON keys without prototype injection", () => {
      for (const key of ["__proto__", "constructor", "prototype"]) {
        const body = JSON.parse(
          `{"value":{"nested":{"${key}":{"polluted":true}}}}`,
        );
        const h = run(config({ type: "object", strategy: "deep-merge" }), {
          responseBody: body,
          initial: { environment: { value: "{}" } },
        });
        failed(h, /convert value/);
        assert.equal(envValue(h), "{}");
        assert.equal(h.run("({}).polluted"), undefined);
        assert.equal({}.polluted, undefined);
      }
    });

    it("rejects non-JSON-compatible values, cycles, and non-plain objects", () => {
      const cycle = {};
      cycle.self = cycle;
      for (const value of [
        cycle,
        { x: undefined },
        { x: NaN },
        new Date(),
        1n,
      ]) {
        const h = run(config({ type: "object" }), { responseBody: { value } });
        failed(h, /convert value/);
        assert.equal(h.writes.length, 0);
      }
    });

    it("reports transformation errors and never saves an untransformed value", async () => {
      for (const magic of [
        "not valid js !",
        "42",
        "() => { throw new Error('private-transform-value'); }",
        "async value => value",
        "() => Promise.reject(new Error('private-rejection'))",
        "() => ({then(resolve) { resolve(1); }})",
      ]) {
        const h = run(config({ magic }), {
          responseBody: { value: "private-source-value" },
          initial: { environment: { value: "keep" } },
        });
        failed(h, /transform value/);
        assert.equal(envValue(h), "keep");
        assert.doesNotMatch(h.tests[0].error, /private-/);
      }
      // Let rejected promises drain; Node's test runner catches unhandled rejections.
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("keeps parsing failures independent across body groups", () => {
      const h = run(
        {
          res_jbody_to_env: { response: ["value"] },
          req_jbody_to_env: { request: ["value"] },
          req_fbody_to_env: { form: ["value"] },
        },
        {
          responseBody: { value: "response" },
          request: {
            body: {
              raw: "private-invalid-json",
              formdata: { toObject: () => ({ value: "form" }) },
            },
          },
        },
      );
      failed(h, /Unable to read request JSON/);
      assert.equal(envValue(h, "response"), "response");
      assert.equal(envValue(h, "form"), "form");
      assert.doesNotMatch(h.tests[0].error, /private-invalid-json/);
    });

    it("does not pretend a non-JSON response is a JSON body", () => {
      const h = run(
        {
          res_jbody_to_env: { response: ["code"] },
          req_jbody_to_env: { request: ["value"] },
        },
        { nonJsonResponse: true, request: { body: { raw: '{"value":"ok"}' } } },
      );
      failed(h, /Unable to read response JSON/);
      assert.equal(envValue(h, "response"), undefined);
      assert.equal(envValue(h, "request"), "ok");
      assert.doesNotMatch(h.tests[0].error, /private-response-body/);
    });

    it("reports missing or wrong-mode request bodies without crashing other groups", () => {
      for (const request of [
        {},
        { body: { mode: "formdata", raw: '{"value":1}' } },
        { body: { mode: "raw", raw: "bad" } },
      ]) {
        const h = run(
          { ...config(), req_jbody_to_col: { value: ["value"] } },
          { request, responseBody: { value: "ok" } },
        );
        failed(h, /Unable to read request JSON/);
        assert.equal(envValue(h), "ok");
      }
      const form = run(
        { req_fbody_to_env: { value: ["value"] } },
        { request: { body: { mode: "raw", raw: "{}" } } },
      );
      failed(form, /Unable to read request form-data/);
    });

    it("rejects unexpected response codes before writing variables", () => {
      const h = run(config(), {
        code: 500,
        responseBody: { value: "do not save" },
      });
      failed(h, /response status 500/);
      assert.equal(h.writes.length, 0);
      assert.equal(h.responseReads, 0);
    });

    it("fails closed for absent or invalid response status and validates res_codes", () => {
      for (const response of [
        undefined,
        { json: () => ({}) },
        { code: 0, json: () => ({}) },
        { code: 999, json: () => ({}) },
      ]) {
        const h = run(config(), { response });
        failed(h, /response status code/);
        assert.equal(h.writes.length, 0);
      }
      for (const res_codes of ["200", ["200"], [0], [600]]) {
        failed(run({ res_codes }), /res_codes must be an array/);
      }
      failed(run({ res_codes: [] }), /not allowed/);
    });

    it("rejects a non-string prefix before writing variables", () => {
      const h = run(
        { ...config(), prefix: {} },
        { responseBody: { value: "ok" } },
      );
      failed(h, /prefix must be a string/);
      assert.equal(h.writes.length, 0);
    });

    it("supports the legacy transport status fallback without requiring transport", () => {
      const h = run(config(), {
        response: {
          transport: { http: { statusCode: 201 } },
          json: () => ({ value: "ok" }),
        },
      });
      passed(h);
      assert.equal(envValue(h), "ok");
    });

    it("runs only the guard in prerequest, even if response data happens to exist", () => {
      const h = run(
        { ...config(), guard: { env_name_like: "^Local$" } },
        { eventName: "prerequest" },
      );
      assert.equal(h.tests.length, 0);
      assert.equal(h.responseReads, 0);
      assert.equal(h.writes.length, 0);
    });

    it("skips a rejected prerequest and reports a clear environment error", () => {
      const h = createHarness(
        { guard: { env_name_like: "^Staging$" } },
        { eventName: "prerequest", response: undefined },
      );
      assert.throws(() => h.run(script), /environment does not match/);
      assert.equal(h.skipped, 1);
      assert.equal(h.tests.length, 0);
      assert.equal(h.writes.length, 0);
    });

    it("validates all regex patterns and skips on an invalid pattern", () => {
      for (const env_name_like of ["[", ["Local", "["], [123]]) {
        const h = createHarness(
          { guard: { env_name_like } },
          { eventName: "prerequest" },
        );
        assert.throws(() => h.run(script), /invalid magic.guard/);
        assert.equal(h.skipped, 1);
      }
    });

    it("does not pretend errors cancel requests when skipRequest is unavailable", () => {
      const h = createHarness(
        { guard: { env_name_like: "^Staging$" } },
        { eventName: "prerequest", noExecution: true },
      );
      assert.throws(
        () => h.run(script),
        /request cancellation cannot be guaranteed/,
      );
      assert.equal(h.skipped, 0);
    });

    it("accepts regex arrays and never mutates global/sticky pattern state", () => {
      const expression = /Local/g;
      expression.lastIndex = 100;
      const h = run({ guard: { env_name_like: ["^Staging$", expression] } });
      passed(h);
      h.run(script);
      assert.ok(h.tests.every((test) => test.passed));
      assert.equal(expression.lastIndex, 100);
      assert.equal(h.skipped, 0);
    });

    it("checks guards after responses without attempting retroactive cancellation", () => {
      const h = createHarness({ ...config(), guard: { env_name_like: [] } });
      assert.throws(() => h.run(script), /environment does not match/);
      assert.equal(h.skipped, 0);
      assert.equal(h.writes.length, 0);
    });

    it("supports an empty regex and a missing environment name safely", () => {
      const h = createHarness({ guard: { env_name_like: "" } });
      h.pm.environment.name = undefined;
      h.run(script);
      passed(h);
    });

    it("rejects non-HTTP hooks and supports older hosts without event metadata", () => {
      const h = createHarness({}, { eventName: "beforeInvoke" });
      assert.throws(() => h.run(script), /only HTTP prerequest\/test/);
      passed(run({}, { noInfo: true }));
      const pre = run({}, { noInfo: true, response: undefined });
      assert.equal(pre.tests.length, 0);
    });

    it("rejects invalid mapping definitions while continuing valid entries", () => {
      for (const definition of [
        "path",
        ["value", { strategy: "invalid" }],
        ["value", { type: "invalid" }],
        ["value", { on_missing: "ignore" }],
        ["value", null],
        [-1],
        [false],
      ]) {
        const h = run(
          { res_jbody_to_env: { broken: definition, value: ["value"] } },
          { responseBody: { value: "ok" } },
        );
        failed(h, /environment\.broken/);
        assert.equal(envValue(h), "ok");
      }
      for (const invalid of [null, [], false, "bad"]) {
        failed(run({ res_jbody_to_env: invalid }), /Mapping must be an object/);
      }
    });

    it("redacts setter errors and still saves subsequent variables", () => {
      const h = run(
        { res_jbody_to_env: { broken: ["value"], value: ["value"] } },
        {
          responseBody: { value: "private-mapped-value" },
          failWrite: "broken",
        },
      );
      failed(h, /environment\.broken.*save variable/);
      assert.equal(envValue(h), "private-mapped-value");
      assert.doesNotMatch(h.tests[0].error, /private-/);
    });

    it("never logs mapped values, even with debugging enabled", () => {
      for (const debug of [false, true]) {
        const h = run(
          { ...config(), debug },
          { responseBody: { value: "private-token" } },
        );
        passed(h);
        assert.doesNotMatch(JSON.stringify(h.logs), /private-token/);
        assert.equal(h.logs.length, debug ? 1 : 0);
      }
    });

    it("uses the documented pm.info.requestName metadata", () => {
      const h = createHarness();
      h.pm.info.requestName = "Saved request name";
      h.run(script);
      passed(h);
      assert.equal(h.tests[0].name, "Saved request name");
    });

    it("uses a fallback test name when request metadata is absent", () => {
      const h = run({}, { request: {} });
      passed(h);
      assert.equal(h.tests[0].name, "Magic Postman Scripts");
    });
  });
}
