// Optional real-runtime smoke test. Requires Postman CLI on PATH, or POSTMAN_BIN.
// NEWMAN_BIN explicitly selects an additional Newman compatibility check.
// Collection/environment/report files are temporary; all HTTP stays on loopback.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function main() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "magic-postman-smoke-"),
  );
  const bundle = fs.readFileSync(
    path.join(import.meta.dirname, "../magic-postman-scripts.js"),
    "utf8",
  );
  const newman = Boolean(process.env.NEWMAN_BIN);
  const runnerName = newman ? "Newman" : "Postman CLI";
  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ url: request.url, body });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ data: { id: 42, tags: [[2, 3]], flag: false } }),
      );
    });
  });

  function event(listen, code) {
    return {
      listen,
      script: { type: "text/javascript", exec: code.split("\n") },
    };
  }
  const evaluate = "eval(pm.collectionVariables.get('magic'));";
  function requestItem(name, url, body, configuration, assertions) {
    return {
      name,
      request: { method: "POST", url, body },
      event: [
        event(
          "prerequest",
          `const magic = {guard: {env_name_like: '^Local$'}};\n${evaluate}`,
        ),
        event(
          "test",
          `const magic = ${JSON.stringify(configuration)};\n${evaluate}\npm.test('smoke assertions', () => {\n${assertions}\n});`,
        ),
      ],
    };
  }
  function collection(items) {
    return {
      info: {
        name: "Magic scripts local smoke",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        { key: "magic", value: bundle },
        { key: "amount", value: "12" },
      ],
      item: items,
    };
  }
  async function run(label, input, environment) {
    const collectionPath = path.join(directory, `${label}.collection.json`);
    const environmentPath = path.join(directory, `${label}.environment.json`);
    const reportPath = path.join(directory, `${label}.report.json`);
    fs.writeFileSync(collectionPath, JSON.stringify(input));
    fs.writeFileSync(environmentPath, JSON.stringify(environment));
    let output = "";
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        newman ? process.env.NEWMAN_BIN : process.env.POSTMAN_BIN || "postman",
        [
          ...(newman ? ["run"] : ["collection", "run"]),
          collectionPath,
          "-e",
          environmentPath,
          ...(newman
            ? ["--reporters", "json", "--reporter-json-export", reportPath]
            : ["--no-report-events", "--disable-unicode"]),
          "--timeout",
          "15000",
          "--timeout-request",
          "3000",
        ],
        {
          env: {
            ...process.env,
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            ALL_PROXY: "",
            NO_PROXY: "127.0.0.1,localhost",
          },
        },
      );
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) console.error(output);
        resolve(code);
      });
    });
    if (newman) {
      assert.ok(fs.existsSync(reportPath), "Newman must produce a JSON report");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      return { exitCode, run: report.run };
    }
    // --output requires login in current CLI releases. Parse the local text
    // summary instead; never log in or upload a run just to test this library.
    const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
    function stat(name) {
      const row = plain
        .split("\n")
        .find((line) => line.includes(` ${name} `) && line.includes("|"));
      assert.ok(row, `Missing ${name} summary from Postman CLI: ${plain}`);
      const columns = row.split("|").map((column) => column.trim());
      return { total: Number(columns[2]), failed: Number(columns[3]) };
    }
    return {
      exitCode,
      output: plain,
      run: {
        stats: { assertions: stat("assertions"), requests: stat("requests") },
        failures: [],
      },
    };
  }

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const input = collection([
      requestItem(
        "Response mapping with plain-text request",
        `${base}/plain`,
        { mode: "raw", raw: "not JSON" },
        {
          res_codes: [201],
          prefix: "smoke_",
          res_jbody_to_env: {
            id: ["data", "id"],
            tags: ["data", "tags", { type: "array", strategy: "deep-merge" }],
          },
          res_jbody_to_col: { payload: ["data", { type: "object" }] },
          res_jbody_to_globals: { flag: ["data", "flag", { type: "boolean" }] },
        },
        `
        pm.expect(pm.environment.get('smoke_id')).to.eql('42');
        pm.expect(JSON.parse(pm.environment.get('smoke_tags'))).to.eql([[1], [2, 3]]);
        pm.expect(JSON.parse(pm.collectionVariables.get('smoke_payload')).id).to.eql(42);
        pm.expect(pm.globals.get('smoke_flag')).to.eql('false');
      `,
      ),
      requestItem(
        "Request JSON replacement",
        `${base}/json`,
        { mode: "raw", raw: '{"value":{{amount}}}' },
        {
          res_codes: [201],
          req_jbody_to_env: { amount: ["value", { type: "number" }] },
          req_jbody_to_col: { amount: ["value"] },
          req_jbody_to_globals: { amount: ["value"] },
        },
        `
        pm.expect(pm.environment.get('amount')).to.eql('12');
        pm.expect(pm.collectionVariables.get('amount')).to.eql('12');
        pm.expect(pm.globals.get('amount')).to.eql('12');
      `,
      ),
      requestItem(
        "Request form-data mapping",
        `${base}/form`,
        {
          mode: "formdata",
          formdata: [{ key: "value", value: "form-value", type: "text" }],
        },
        {
          res_codes: [201],
          req_fbody_to_env: { form: ["value"] },
          req_fbody_to_col: { form: ["value"] },
          req_fbody_to_globals: { form: ["value"] },
        },
        `
        pm.expect(pm.environment.get('form')).to.eql('form-value');
        pm.expect(pm.collectionVariables.get('form')).to.eql('form-value');
        pm.expect(pm.globals.get('form')).to.eql('form-value');
      `,
      ),
    ]);
    const allowed = await run("allowed", input, {
      name: "Local",
      values: [{ key: "smoke_tags", value: "[[1]]", enabled: true }],
    });
    assert.equal(allowed.exitCode, 0, JSON.stringify(allowed.run.failures));
    assert.deepEqual(allowed.run.failures, []);
    assert.equal(allowed.run.stats.assertions.total, 6);
    assert.equal(received.length, 3);
    assert.equal(received[0].body, "not JSON");
    assert.deepEqual(JSON.parse(received[1].body), { value: 12 });
    assert.match(received[2].body, /form-value/);
    assert.equal(allowed.run.stats.assertions.failed, 0);
    if (newman) {
      for (let index = 0; index < input.item.length; index++) {
        assert.equal(
          allowed.run.executions[index].assertions[0].assertion,
          input.item[index].name,
        );
      }
    } else {
      for (const item of input.item)
        assert.ok(allowed.output.includes(`Pass  ${item.name}`));
    }

    const before = received.length;
    const blocked = await run("blocked", collection([input.item[0]]), {
      name: "Production",
      values: [],
    });
    assert.equal(
      received.length,
      before,
      "Rejected guard must prevent HTTP transmission",
    );
    assert.equal(blocked.run.stats.requests.total, 0);
    assert.equal(blocked.run.stats.assertions.total, 0);
    assert.equal(blocked.exitCode, 0);
    assert.deepEqual(blocked.run.failures, []);
    console.log(
      `${runnerName} smoke passed: ${allowed.run.stats.assertions.total} assertions, 3 loopback requests, 1 guarded request blocked.`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
