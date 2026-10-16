"use strict";

function guard_before_query() {
  const env_name_like = magic.guard?.env_name_like;
  const curr = pm.environment.name;
  let ok = env_name_like ? false : true;
  if (env_name_like) {
    if (Array.isArray(env_name_like)) {
      ok = env_name_like.some((like) => new RegExp(like).test(curr));
    } else {
      ok = new RegExp(env_name_like).test(curr);
    }
  }
  if (!ok) {
    throw new Error(`Use with "${env_name_like}"-like named environment!`);
  }
}

function deep_merge(...objects) {
  const isObject = (obj) => obj && typeof obj === "object";
  return objects.reduce((prev, obj) => {
    Object.keys(obj).forEach((key) => {
      const pVal = prev[key];
      const oVal = obj[key];
      if (Array.isArray(pVal) && Array.isArray(oVal)) {
        prev[key] = pVal.concat(...oVal);
      } else if (isObject(pVal) && isObject(oVal)) {
        prev[key] = deep_merge(pVal, oVal);
      } else {
        prev[key] = oVal;
      }
    });
    return prev;
  }, {});
}

function mapping(mapping, source, destination, prefix = "") {
  if (!mapping) return;
  Object.entries(mapping).forEach(([k, mayBePath]) => {
    const last = mayBePath.pop();
    const path = mayBePath;
    if (!last) {
      return;
    }
    const options = {
      type: "string",
      strategy: "replace",
      magic: null,
    };
    if (typeof last === "string") {
      path.push(last);
    } else {
      last.type && (options.type = last.type);
      last.strategy && (options.strategy = last.strategy);
      last.magic && (options.magic = last.magic);
    }
    let value = path.reduce((acc, p) => acc[p], source);
    if (options.magic) {
      try {
        const transform = eval(options.magic);
        value = transform(value);
      } catch {
        console.info("PROBLEM: unable to make magic transformation for value");
      }
    }
    const key = prefix + k;
    const prev = pm[destination].get(key);
    if (prev && options.strategy === "propose") {
      value = prev;
      console.info(
        "The old value will be used. New will be ignored. Becase of <propose> strategy.",
      );
    } else if (
      options.strategy === "replace" || /// this is the exactly strategy that will be used for all another inline or-like conditions
      !prev || /// nothing to do with strategies
      options.type !== typeof prev && /// for types mismatch between prev and new values we use default <replace> strategy
        options.type === "array" && !Array.isArray(prev) ||
      !["object", "array"].includes(options.type)
    );
    else {
      if (options.strategy === "merge") {
        value = Array.isArray(value)
          ? [...prev, ...value]
          : { ...prev, ...value };
      } else if (options.strategy === "deep-merge") {
        value = deep_merge(prev, value);
      } else {
        throw new Error(
          "MAGIC_ERROR: not exhaustive condition pipe was used to check <strategy>",
        );
      }
    }
    console.info(
      `Set ${destination}.${
        prefix + k
      } = ${value} (as ${options.type} data-type)`,
    );
    pm[destination].set(
      key,
      value,
      options.type,
    );
  });
}

function test_after_response() {
  const {
    name = pm.request.name,
    description,
  } = magic;
  name && console.info(name);
  pm.test(name, () => {
    const {
      res_codes = [200, 201, 202, 203, 204],
      res_jbody_to_env,
      res_jbody_to_col,
      res_jbody_to_globals,
      req_jbody_to_env,
      req_jbody_to_col,
      req_jbody_to_globals,
      req_fbody_to_env,
      req_fbody_to_globals,
      req_fbody_to_col,
      prefix,
    } = magic;
    const actual_res_code = pm.response.code ||
      pm.response.transport.http?.statusCode;
    if (!actual_res_code) {
      console.warn("Unable to get res status code... Please open the issue");
    } else if (!res_codes.includes(actual_res_code)) {
      console.warn("Response code is not declared in <magic.res_codes>");
      pm.expect(res_codes).includes(actual_res_code);
      return;
    }
    let jData = {};
    try {
      jData = pm.response.json();
    } catch (err) {
      jData = pm.response;
    }
    const rawReqBody = JSON.parse(pm.request.body?.raw || "{}");
    let fData = {};
    try {
      fData = pm.request.body.formdata.toObject();
    } catch {
    }
    mapping(res_jbody_to_env, jData, "environment", prefix);
    mapping(res_jbody_to_col, jData, "collectionVariables", prefix);
    mapping(res_jbody_to_globals, jData, "globals", prefix);
    mapping(req_jbody_to_env, rawReqBody, "environment", prefix);
    mapping(req_jbody_to_col, rawReqBody, "collectionVariables", prefix);
    mapping(req_jbody_to_globals, rawReqBody, "globals", prefix);
    mapping(req_fbody_to_env, fData, "environment", prefix);
    mapping(req_fbody_to_col, fData, "collectionVariables", prefix);
    mapping(req_fbody_to_globals, fData, "globals", prefix);
  });
}

guard_before_query();
test_after_response();
