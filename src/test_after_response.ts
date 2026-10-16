import { mapping } from "./lib/mapping";
import { is_record } from "./helpers/deep_merge";

type MappingGroup = readonly [Mapping | undefined, VarScopeName];
const has_mappings = (groups: readonly MappingGroup[]) =>
  groups.some(
    ([configuration]) =>
      configuration !== undefined &&
      (!is_record(configuration) || Object.keys(configuration).length > 0),
  );

export function test_after_response(): void {
  const name =
    magic.name ||
    pm.info?.requestName ||
    pm.request.name ||
    "Magic Postman Scripts";

  pm.test(name, () => {
    const resCodes = magic.res_codes ?? [200, 201, 202, 203, 204];
    const code = pm.response?.code || pm.response?.transport?.http?.statusCode;
    if (
      !Array.isArray(resCodes) ||
      !resCodes.every(
        (value) => Number.isInteger(value) && value >= 100 && value <= 599,
      )
    )
      throw new Error(
        "MAGIC_ERROR: res_codes must be an array of HTTP status codes",
      );
    if (!Number.isInteger(code) || !code || code < 100 || code > 599) {
      throw new Error("MAGIC_ERROR: missing or invalid response status code");
    }
    if (!resCodes.includes(code)) {
      throw new Error(
        `MAGIC_ERROR: response status ${code} is not allowed by res_codes`,
      );
    }

    if (magic.prefix !== undefined && typeof magic.prefix !== "string") {
      throw new Error("MAGIC_ERROR: prefix must be a string");
    }
    const failures: string[] = [];
    const prepared: { groups: readonly MappingGroup[]; source: unknown }[] = [];
    const prepare = (
      label: string,
      groups: readonly MappingGroup[],
      load: () => unknown,
    ) => {
      if (!has_mappings(groups)) return;
      let source: unknown;
      try {
        source = load();
      } catch {
        failures.push(`Unable to read ${label} for configured mappings`);
        return;
      }
      prepared.push({ groups, source });
    };

    prepare(
      "response JSON",
      [
        [magic.res_jbody_to_env, "environment"],
        [magic.res_jbody_to_col, "collectionVariables"],
        [magic.res_jbody_to_globals, "globals"],
      ],
      () => {
        if (!pm.response) throw new Error();
        return pm.response.json();
      },
    );

    prepare(
      "request JSON",
      [
        [magic.req_jbody_to_env, "environment"],
        [magic.req_jbody_to_col, "collectionVariables"],
        [magic.req_jbody_to_globals, "globals"],
      ],
      () => {
        const body = pm.request.body;
        if (!body || (body.mode !== undefined && body.mode !== "raw"))
          throw new Error();
        if (typeof body.raw !== "string") throw new Error();
        const raw = pm.variables ? pm.variables.replaceIn(body.raw) : body.raw;
        return JSON.parse(raw);
      },
    );

    prepare(
      "request form-data",
      [
        [magic.req_fbody_to_env, "environment"],
        [magic.req_fbody_to_col, "collectionVariables"],
        [magic.req_fbody_to_globals, "globals"],
      ],
      () => {
        const body = pm.request.body;
        if (!body || (body.mode !== undefined && body.mode !== "formdata"))
          throw new Error();
        if (!body.formdata) throw new Error();
        return body.formdata.toObject();
      },
    );

    // Snapshot all inputs before writes can change request-template variables.
    for (const { groups, source } of prepared) {
      for (const [configuration, destination] of groups) {
        try {
          mapping(configuration, source, destination, magic.prefix);
        } catch (error) {
          // mapping() emits sanitized context, not values or original exceptions.
          failures.push(
            error instanceof Error ? error.message : "Unable to apply mapping",
          );
        }
      }
    }
    if (failures.length) throw new Error("MAGIC_ERROR: " + failures.join("; "));
  });
}
