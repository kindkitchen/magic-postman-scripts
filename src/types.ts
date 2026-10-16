export {};

declare global {
  type VarConvertType = "string" | "boolean" | "number" | "object" | "array";
  type SetStrategy = "replace" | "propose" | "merge" | "deep-merge";
  type PathSegment = string | number;
  type MayBeOptions = {
    type?: VarConvertType;
    strategy?: SetStrategy;
    /** Trusted, synchronous JavaScript function expression. */
    magic?: string | null;
    on_missing?: "error" | "skip";
  };
  type MayBePath =
    readonly PathSegment[] | readonly [...PathSegment[], MayBeOptions];
  type Mapping = Readonly<Record<string, MayBePath>>;
  type VarScopeName = "environment" | "collectionVariables" | "globals";
  interface VariableScope {
    get(name: string): unknown;
    has?(name: string): boolean;
    set(name: string, value: string): void;
  }
  interface MagicConfig {
    name?: string;
    description?: string;
    res_codes?: readonly number[];
    res_jbody_to_env?: Mapping;
    res_jbody_to_col?: Mapping;
    res_jbody_to_globals?: Mapping;
    req_jbody_to_env?: Mapping;
    req_jbody_to_col?: Mapping;
    req_jbody_to_globals?: Mapping;
    req_fbody_to_env?: Mapping;
    req_fbody_to_globals?: Mapping;
    req_fbody_to_col?: Mapping;
    prefix?: string;
    debug?: boolean;
    guard?: {
      env_name_like?: string | RegExp | readonly (string | RegExp)[];
    };
  }
  const magic: MagicConfig;
  const pm: Record<VarScopeName, VariableScope> & {
    environment: VariableScope & { name?: string };
    info?: { eventName?: string; requestName?: string };
    execution?: { skipRequest?: () => void };
    variables?: { replaceIn(value: string): string };
    test(name: string, callback: () => void): void;
    request: {
      name?: string;
      body?: {
        mode?: string;
        raw?: string;
        formdata?: { toObject(): Record<string, unknown> };
      };
    };
    response?: {
      code?: number;
      json(): unknown;
      transport?: { http?: { statusCode?: number } };
    };
  };
}
