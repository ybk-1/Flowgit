import { host, path } from "./host/current.js";


export type FindingSeverity = "high" | "medium";

export interface Finding {
  /** Path relative to the flow directory, using "/". */
  file: string;
  /** 1-based line number. */
  line: number;
  kind: string;
  severity: FindingSeverity;
  /** First 4 characters of the secret, then an ellipsis. Never the whole value. */
  preview: string;
}

const MAX_BYTES = 1024 * 1024;

interface Rule {
  kind: string;
  severity: FindingSeverity;
  re: RegExp;
  /** The sensitive substring inside the match. */
  value: (match: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  { kind: "sk-key", severity: "high", re: /sk-[A-Za-z0-9_-]{16,}/g, value: (m) => m[0] },
  { kind: "aws-key", severity: "high", re: /AKIA[A-Z0-9]{16}/g, value: (m) => m[0] },
  { kind: "github-token", severity: "high", re: /ghp_[A-Za-z0-9_]{10,}/g, value: (m) => m[0] },
  { kind: "github-token", severity: "high", re: /github_pat_[A-Za-z0-9_]{10,}/g, value: (m) => m[0] },
  { kind: "slack-token", severity: "high", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, value: (m) => m[0] },
  { kind: "private-key", severity: "high", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, value: (m) => m[0] },
  { kind: "google-key", severity: "high", re: /AIza[0-9A-Za-z_-]{35}/g, value: (m) => m[0] },
  // A literal token after "Bearer"; "Bearer {{env.NAME}}" does not match.
  { kind: "bearer-token", severity: "high", re: /Bearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g, value: (m) => m[1] ?? m[0] },
  // https://TOKEN@host or https://user:password@host. Other schemes only with a password, so ssh://git@host is fine.
  { kind: "url-credentials", severity: "high", re: /https?:\/\/([^\s/@:"'<>]+(?::[^\s/@"'<>]+)?)@[A-Za-z0-9.-]+/gi, value: (m) => m[1] ?? m[0] },
  {
    kind: "url-credentials",
    severity: "high",
    re: /(?<![A-Za-z0-9+.-])(?!https?:\/\/)[a-z][a-z0-9+.-]*:\/\/([^\s/@:"'<>]+:[^\s/@"'<>]+)@[A-Za-z0-9.-]+/gi,
    value: (m) => m[1] ?? m[0],
  },
  {
    kind: "secret-assignment",
    severity: "high",
    re: /(?:["'])?(api[_-]?key|access[_-]?key|secret|token|password)(?:["'])?\s*[:=]\s*["']([^"']{12,})["']/gi,
    value: (m) => m[2] ?? m[0],
  },
  { kind: "email", severity: "medium", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, value: (m) => m[0] },
  { kind: "local-path", severity: "medium", re: /[A-Za-z]:\\Users\\[^\\\s]+/g, value: (m) => m[0] },
  { kind: "local-path", severity: "medium", re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, value: (m) => m[0] },
];

/** Show only the first 4 characters. Longer values get an ellipsis and nothing else. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return value;
  return `${value.slice(0, 4)}…`;
}

/** Any file up to 1 MB that looks like text (no NUL byte), whatever its extension: a key can hide in a .ps1 or .cfg too. */
function scannable(abs: string): boolean {
  const stat = host().stat(abs);
  if (!stat.isFile() || stat.size > MAX_BYTES) return false;
  return !host().readFile(abs).includes(0);
}

/**
 * Look through text files for secrets, emails and local user paths.
 * `files` are paths relative to `dir`. Files over 1 MB are skipped.
 */
export function findPrivateData(dir: string, files: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const rel of files) {
    const normalized = rel.split(path.sep).join("/");
    const abs = path.join(dir, ...normalized.split("/"));
    if (!host().exists(abs) || !scannable(abs)) continue;
    const lines = host().readFile(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        for (const match of line.matchAll(rule.re)) {
          const secret = rule.value(match);
          findings.push({
            file: normalized,
            line: index + 1,
            kind: rule.kind,
            severity: rule.severity,
            preview: maskSecret(secret),
          });
        }
      }
    });
  }
  return findings;
}
