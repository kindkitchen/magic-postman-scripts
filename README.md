# Magic Postman Scripts

Validate HTTP response codes and copy request/response data into Postman environment, collection, or global variables using a small configuration object.

## Install and use

1. Create a **collection variable** named `magic` and paste the entire contents of [`magic-postman-scripts.js`](./magic-postman-scripts.js) into its value as raw JavaScript (not a JSON-quoted string).
2. Define a local `magic` configuration, then evaluate the collection variable in a script:

```javascript
const magic = {
  name: "Create order",
  guard: { env_name_like: "^(Local|Staging)$" },
  res_codes: [201],
  prefix: "order_",
  res_jbody_to_env: {
    id: ["data", "id"],
    tags: ["data", "tags", { type: "array", strategy: "merge" }],
    total: ["data", "total", { type: "number" }],
  },
};
eval(pm.collectionVariables.get("magic"));
```

Use this pattern in **Post-response** to validate/map responses. Use it in **Pre-request** as well when you want the environment guard to prevent sending a request. You may use a smaller configuration containing only `guard` in Pre-request. A response check cannot retroactively stop a request.

The supported protocol is HTTP. The script dispatches using `pm.info.eventName`: `prerequest` runs the environment guard only; `test` runs the guard, response validation, and mappings. Other event names are rejected. In older/custom hosts without event metadata, the presence of `pm.response` determines the phase.

Only evaluate trusted scripts and configurations. The collection variable contains executable JavaScript.

## Configuration contract

All properties are optional. Unknown properties are ignored.

| Property              | Meaning                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | Test name; defaults to the request name, then `Magic Postman Scripts`.                                                                          |
| `description`         | Optional human-readable metadata; not executed or logged.                                                                                       |
| `res_codes`           | Allowed HTTP codes. Defaults to `[200, 201, 202, 203, 204]`. A missing/invalid response status fails the test.                                  |
| `prefix`              | Prefix applied to every destination variable name. Defaults to `""`.                                                                            |
| `guard.env_name_like` | Regular expression string, `RegExp`, or array of either. At least one must match the selected environment name. An empty array matches nothing. |
| `debug`               | Log destination names, types, and strategy decisions. Defaults to `false`. Values are **never** logged by this library.                         |

### Mapping groups

Each group is an object whose keys are destination variable names and whose values are paths:

| Input             | Environment        | Collection         | Globals                |
| ----------------- | ------------------ | ------------------ | ---------------------- |
| Response JSON     | `res_jbody_to_env` | `res_jbody_to_col` | `res_jbody_to_globals` |
| Request raw JSON  | `req_jbody_to_env` | `req_jbody_to_col` | `req_jbody_to_globals` |
| Request form-data | `req_fbody_to_env` | `req_fbody_to_col` | `req_fbody_to_globals` |

```javascript
const magic = {
  res_jbody_to_env: {
    id: ["data", "id"],
    first_item: ["items", 0, "id"], // string indices such as "0" also work
    optional_label: ["label", { on_missing: "skip" }],
    payload: [{ type: "object" }], // an empty path selects the whole JSON body
    normalized_name: ["name", { magic: "value => value.trim()" }],
  },
};
```

### How a path selects a value

Read a mapping from left to right. Each **string or number** moves one step into the source body: a string names an object property, and a number selects an array index. For example:

```javascript
// Source body:
const body = {
  order: {
    lines: [{ quantity: "0042" }],
  },
};

// Mapping entry:
const mapping = {
  first_quantity: ["order", "lines", 0, "quantity", { type: "number" }],
};
```

The path is `["order", "lines", 0, "quantity"]`, equivalent to reading `body.order.lines[0].quantity`. It selects the value `"0042"`.

The trailing `{ type: "number" }` is **not another step in the path**. Objects cannot be path segments, so the library recognizes a final object as instructions for processing the value already selected. In this example, it converts `"0042"` to the number `42`, then saves the text `"42"` in the destination variable `first_quantity`.

More precisely, the library:

1. Copies the mapping array so the configuration remains unchanged.
2. If the final element is an object, separates it from the path as options.
3. Walks the remaining string/number segments to select the source value.
4. Applies the options to that value: transformation, conversion/validation, then the selected write/merge strategy. `propose` can leave an existing destination untouched before reading the source; `on_missing` decides what to do if the path is absent.
5. Stores the final value as text in Postman.

The options object is allowed **only at the end**. For example, `["order", { type: "number" }, "quantity"]` is invalid. To select a source property actually named `type`, use the string `"type"`, not an object: `["order", "type"]`.

With no trailing object, all elements form the path and the default options apply. With **only** an options object, there are no path steps, so the entire source body is selected: `[{ type: "object" }]`. An empty array `[]` also selects the whole body, using the defaults.

### Options for the selected value

The final options object can contain:

| Option       | Default     | Meaning                                                                                                                                                                                                        |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`       | `"string"`  | `string`, `number`, `boolean`, `object`, or `array`. See conversions below.                                                                                                                                    |
| `strategy`   | `"replace"` | `replace`, `propose`, `merge`, or `deep-merge`.                                                                                                                                                                |
| `magic`      | `null`      | Trusted JavaScript **synchronous function expression** represented as a string. It receives the selected value before conversion. Arrow functions and parenthesized/unparenthesized function expressions work. |
| `on_missing` | `"error"`   | A missing/undefined field fails the mapping with its destination and path. `skip` leaves the existing variable untouched. Inherited properties are not traversed.                                              |

Mapping configurations are never mutated and may be reused or frozen. An empty path `[]` selects the whole input. Explicit `null` is a value, not a missing field.

### Types and serialization

**Every value this library saves in Postman is text.** The `type` option controls how the selected value is checked and processed **before** it is saved; it does not make Postman store a JavaScript number, boolean, or object. Postman's setters accept `(name, value)`, not a third type argument.

#### The default: `type: "string"`

You do not need to choose a type just to save a value. By default:

- Text is kept as-is: `"hello"` stays `"hello"`, and `"0042"` stays `"0042"`.
- Numbers, booleans, and null become readable text: `42` becomes `"42"`, `false` becomes `"false"`, and `null` becomes `"null"`.
- Objects and arrays become **JSON text**, so their contents are preserved. For example, `{ id: 42 }` becomes the string `'{"id":42}'`, and `["a", "b"]` becomes the string `'["a","b"]'`. This avoids JavaScript's unhelpful default object text, `"[object Object]"`.

The outer quotes in these examples indicate a JavaScript string; they are not extra characters added around the stored value.

#### When to choose another type

Choose a type when you need validation, normalization, or structured merging:

| `type`               | Selected input | What is checked/converted before storage            | What `.get()` returns |
| -------------------- | -------------- | --------------------------------------------------- | --------------------- |
| `"string"` (default) | `"0042"`       | Nothing; keep the text                              | `"0042"`              |
| `"number"`           | `"0042"`       | Convert to the finite number `42`                   | `"42"`                |
| `"boolean"`          | `0`            | Convert to the boolean `false`                      | `"false"`             |
| `"object"`           | `{ id: 42 }`   | Require an object; apply object merges if requested | `'{"id":42}'`         |
| `"array"`            | `["a", "b"]`   | Require an array; apply array merges if requested   | `'["a","b"]'`         |

- **number:** accepts finite numbers or nonempty numeric strings. Booleans, null, blank strings, and non-finite results fail validation without changing the destination.
- **boolean:** accepts booleans, `0`/`1`, and the exact strings `"false"`, `"true"`, `"0"`, `"1"`. It does not treat every nonempty string as true.
- **object / array:** accepts a value of that shape or JSON text representing it. Object values cannot be arrays or null. The library parses JSON input if necessary, checks its shape, applies any merges, and serializes the result back to JSON text. Invalid or unsafe data fails validation.

To use the saved text as a number or object in a later script, convert it back explicitly:

```javascript
pm.environment.get("first_quantity"); // "42" — text
Number(pm.environment.get("first_quantity")); // 42 — a number

pm.environment.get("payload"); // '{"id":42}' — JSON text
JSON.parse(pm.environment.get("payload")); // { id: 42 } — an object
```

The same rules apply to `pm.collectionVariables` and `pm.globals`.

### Strategies

- **replace:** save the converted new value.
- **propose:** leave any existing variable untouched, including `false`, `0`, `""`, and explicit null when the host exposes `has()`. No transformation or conversion is performed if the destination already exists.
- **merge:** shallow-merge objects (new keys win) or concatenate arrays without flattening nested arrays.
- **deep-merge:** recursively merge objects and concatenate arrays at every depth without flattening them. A nested type mismatch uses the new value.

Merge strategies apply only to object/array types. Previously stored JSON is parsed before merging. If the previous value is absent, malformed, or the wrong type, the new value replaces it. Primitive types always replace. Unsafe object keys (`__proto__`, `constructor`, and `prototype`) are rejected during JSON conversion/merging to prevent prototype injection.

### Bodies, failures, and logging

- Bodies are parsed only when a matching mapping group is nonempty. A plain-text request cannot break an unrelated response mapping.
- Inputs are read before any mapping writes, so response mappings cannot accidentally change variables used to resolve request JSON. Request JSON uses `pm.variables.replaceIn()` before parsing, so Postman variable references are resolved. Ensure substituted values still form valid JSON. Post-response replacement uses values available at script execution time; it is not a byte-for-byte capture of the transmitted request, especially for dynamic variables.
- Form-data uses `pm.request.body.formdata.toObject()`; if the host cannot provide it, configured form mappings fail clearly. File uploads are not read from disk.
- Non-JSON responses fail response JSON mappings; they are not silently treated as Postman SDK response objects. Requests without response mappings do not need a JSON response.
- Unexpected response status prevents **all** mappings. With an accepted status, independent mapping failures do not stop remaining mappings/groups. Successful writes remain saved; there is no transaction or rollback. The overall Postman test fails with destination/path context if any mapping failed.
- Transformations must return synchronously; invalid code, exceptions, or promises fail the mapping without saving an untransformed value. Error messages omit values and exception text to avoid exposing secrets.
- Library diagnostics never log mapped values. Your own transformation code can still log data or perform other sandbox actions; use only trusted configurations. Store long-lived credentials in Postman Vault, not in committed configuration.

### Environment guard safety

A rejected environment or invalid pattern in **Pre-request** emits a diagnostic and calls `pm.execution.skipRequest()`. Supported runtimes report it as a skipped request, not a failed response test. Use a runtime exposing that API. If it is unavailable, the library raises an explicit compatibility error, but **cannot guarantee that the runtime will cancel transmission**. Do not rely on a thrown script error as a network safety boundary. No hard-coded Newman version compatibility is assumed.

In Post-response, the guard can prevent mappings but the HTTP request has already happened. Put a guard on every request that needs protection (or at collection/folder Pre-request level).

## Development

Requires **Node.js 26.x** and **Yarn Berry 4.18.1**. `.nvmrc` selects Node 26, `engines.node` declares the supported major, and `packageManager` pins Yarn. The `node-modules` linker preserves ordinary Node dependency resolution. The package, build script, and tests use native ESM (`import`/`export`) throughout; there are no CommonJS wrappers.

Node 26 does not bundle Corepack. If it isn't already installed, set it up once:

```sh
npm install --global corepack
corepack enable
```

Then use Yarn for all project workflows:

```sh
yarn install --immutable # install exactly what yarn.lock specifies
yarn build               # type-check and regenerate dist/index.js + the copy-paste bundle
yarn test                # regression suite for source and committed bundle; no external API calls
yarn check               # read-only validation: types, formatting, tests, bundle freshness
yarn format              # format authored files, not generated bundles
```

Commit `yarn.lock`; do not generate an npm lockfile. After intentionally changing dependencies, run `yarn install` to update the lockfile. `.yarn` install state and `node_modules` are not committed.

TypeScript uses ESM with bundler resolution, `strict`, unchecked-index checking, exact optional properties, and extra control-flow/unused-code checks, with no compiler output. `verbatimModuleSyntax` also enables isolated-module checking; default compiler options are omitted rather than repeated. esbuild remains responsible for bundling.

ESM is the source/tooling module system, not the output format for Postman. The generated `.js` artifact remains a self-contained, ES2022-compatible script without `import`, `export`, or Node dependencies, so it can still be pasted into a collection variable and evaluated. Node 26 is the development-tool runtime, not a new requirement for the Postman sandbox.

The bundle is generated from `src/index.ts`. Do not hand-edit it. After source changes, run `yarn build` before `yarn check`, and commit `magic-postman-scripts.js` with the source.

Tests exercise the source and generated script in isolated sandbox-style contexts. For a real-runtime smoke test, install the [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-installation/) separately, then run `yarn test:postman`. It starts a temporary loopback HTTP server, generates temporary collections/environments, checks mappings in all three scopes, and verifies that the guard actually prevents HTTP transmission. No login is needed, and run-event reporting is disabled. Set `POSTMAN_BIN` if the CLI is not on PATH. An explicit `NEWMAN_BIN` can additionally check Newman compatibility; it is not the default runner. There is no cloud workspace binding or automatic upload.

### Task shortcuts

All tasks are package scripts, invoked as `yarn <task>`:

- `start` runs `build`.
- `clean` removes `dist` without deleting the committed bundle.
- `transpile` remains a compatibility alias for `typecheck`; bundling handles transpilation.
- `typecheck`, `check:bundle`, `format:check`, and `test:postman` remain independently callable.
- `gitam` runs `check`, stages changes, and opens an interactive Git commit.
- `pr` runs `gitam`, pushes `dev`, creates a PR with `gh pr create --fill-verbose`, and enables automatic merging with `gh pr merge --auto --merge`, in that order.

The PR shortcut retains the existing Git workflow and requires GitHub CLI configuration. Run it only intentionally. Build, test, check, and format never commit or push.

### Compatibility changes

Compared with 1.2.0, this version no longer relies on an ignored third setter argument, no longer mutates paths, preserves existing falsy values with `propose`, avoids flattening nested arrays, validates lifecycle hooks, and reports missing fields/transform errors without logging values. Objects/arrays are now consistently JSON-serialized. The unfinished, never-invoked `ctx_*` context API and its dead implementation stub were removed; no context behavior existed to preserve.

## Official Postman references

Implementation follows the current HTTP sandbox contract:

- [Request metadata (`pm.info`)](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-info/)
- [Response access (`pm.response`)](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-response/)
- [Variable APIs and replacement](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-variables/)
- [Variable storage and JSON serialization](https://learning.postman.com/docs/sending-requests/variables/)
- [Execution control and `skipRequest`](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/)
