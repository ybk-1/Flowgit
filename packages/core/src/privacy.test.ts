import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPrivateData, maskSecret } from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("findPrivateData", () => {
  it("flags each high and medium kind and never shows the whole value", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-privacy-"));
    dirs.push(dir);
    const secrets = {
      sk: "sk-abcdefghijklmnopqrstuvwxyz",
      aws: "AKIAIOSFODNN7EXAMPLE",
      ghp: "ghp_abcdefghijklmnopqrstuvwxyz",
      pat: "github_pat_abcdefghijklmnopqrstuvwxyz",
      slack: "xoxb-1234567890-abcdef",
      key: "-----BEGIN RSA PRIVATE KEY-----",
      api: "supersecretvalue",
      email: "dev@example.com",
      win: "C:\\Users\\alice",
      mac: "/Users/bob",
      linux: "/home/carol",
    };
    const body = [
      secrets.sk,
      secrets.aws,
      secrets.ghp,
      secrets.pat,
      secrets.slack,
      secrets.key,
      `api_key = "${secrets.api}"`,
      `secret: "${secrets.api}"`,
      `token = '${secrets.api}'`,
      `"api_key": "${secrets.api}"`,
      `write to ${secrets.email} please`,
      `see ${secrets.win} and ${secrets.mac} and ${secrets.linux}`,
    ].join("\n");
    fs.writeFileSync(path.join(dir, "notes.md"), `${body}\n`);

    const findings = findPrivateData(dir, ["notes.md"]);
    const kinds = findings.map((f) => `${f.line}:${f.kind}:${f.severity}`);
    expect(kinds).toEqual([
      "1:sk-key:high",
      "2:aws-key:high",
      "3:github-token:high",
      "4:github-token:high",
      "5:slack-token:high",
      "6:private-key:high",
      "7:secret-assignment:high",
      "8:secret-assignment:high",
      "9:secret-assignment:high",
      "10:secret-assignment:high",
      "11:email:medium",
      "12:local-path:medium",
      "12:local-path:medium",
      "12:local-path:medium",
    ]);
    for (const secret of Object.values(secrets)) {
      for (const finding of findings) {
        expect(finding.preview).not.toContain(secret);
        expect(finding.preview).not.toBe(secret);
      }
    }
    expect(findings[0]?.preview).toBe(maskSecret(secrets.sk));
    expect(findings[0]?.preview).toBe("sk-a…");
    expect(findings[10]?.preview).toBe("dev@…");
  });

  it("skips files over 1 MB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-privacy-big-"));
    dirs.push(dir);
    const big = Buffer.alloc(1024 * 1024 + 1, "a");
    big.write("sk-abcdefghijklmnopqrstuvwxyz");
    fs.writeFileSync(path.join(dir, "huge.md"), big);
    fs.writeFileSync(path.join(dir, "ok.md"), "sk-abcdefghijklmnopqrstuvwxyz\n");
    const findings = findPrivateData(dir, ["huge.md", "ok.md"]);
    expect(findings.map((f) => f.file)).toEqual(["ok.md"]);
  });
});