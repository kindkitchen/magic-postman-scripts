import vm from "node:vm";

export function createHarness(configuration = {}, options = {}) {
  const logs = [];
  const tests = [];
  const writes = [];
  const stores = {};
  let skipped = 0;
  let responseReads = 0;
  let requestReplacements = 0;

  function scope(name) {
    const store = new Map(Object.entries(options.initial?.[name] ?? {}));
    stores[name] = store;
    return {
      get: (key) => store.get(key),
      has: (key) => store.has(key),
      set(...args) {
        if (args.length !== 2) throw new Error("Setter requires two arguments");
        const [key, value] = args;
        if (typeof value !== "string")
          throw new Error("Expected serialized value");
        if (options.failWrite === key) throw new Error("private-setter-error");
        store.set(key, value);
        writes.push({ scope: name, key, value });
      },
    };
  }

  const pm = {
    environment: {
      ...scope("environment"),
      name: options.environmentName ?? "Local",
    },
    collectionVariables: scope("collectionVariables"),
    globals: scope("globals"),
    info: { eventName: options.eventName ?? "test" },
    request: options.request ?? {
      name: "Example",
      body: { mode: "raw", raw: "{}" },
    },
    response: Object.hasOwn(options, "response")
      ? options.response
      : {
          code: options.code ?? 200,
          json() {
            responseReads++;
            if (options.nonJsonResponse)
              throw new Error("private-response-body");
            return options.responseBody ?? {};
          },
        },
    variables: {
      replaceIn(raw) {
        requestReplacements++;
        return raw.replace(
          /{{([^{}]+)}}/g,
          (match, key) => options.variables?.[key] ?? match,
        );
      },
    },
    execution: {
      skipRequest() {
        skipped++;
      },
    },
    test(name, callback) {
      try {
        callback();
        tests.push({ name, passed: true });
      } catch (error) {
        tests.push({ name, passed: false, error: error.message });
      }
    },
  };
  if (options.noExecution) delete pm.execution;
  if (options.noInfo) delete pm.info;
  if (options.noVariables) delete pm.variables;
  if (options.noHas) {
    for (const name of ["environment", "collectionVariables", "globals"])
      delete pm[name].has;
  }

  const context = vm.createContext({
    magic: configuration,
    pm,
    console: Object.fromEntries(
      ["info", "warn", "error", "log"].map((level) => [
        level,
        (...args) => logs.push({ level, args }),
      ]),
    ),
  });

  return {
    context,
    pm,
    stores,
    tests,
    writes,
    logs,
    get skipped() {
      return skipped;
    },
    get responseReads() {
      return responseReads;
    },
    get requestReplacements() {
      return requestReplacements;
    },
    run(script) {
      return vm.runInContext(script, context, { timeout: 1000 });
    },
    get(scopeName, key) {
      return stores[scopeName].get(key);
    },
  };
}
