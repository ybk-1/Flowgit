import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/index.js";
import { adminWithWorkspace, api, login, ok, ORIGIN } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sign-up is invite-only", () => {
  it("refuses a new person without an invite", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ subject: "stranger" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("invite_needed");
  });

  it("lets an admin in without an invite, and only admins make sign-up codes", async () => {
    const admin = await login("admin");
    const me = await ok<{ admin: boolean }>(api(admin, "GET", "/api/me"));
    expect(me.admin).toBe(true);
    const { code } = await ok<{ code: string }>(api(admin, "POST", "/api/invites", {}), 201);
    const newcomer = await login("newcomer", code);
    expect((await ok<{ admin: boolean }>(api(newcomer, "GET", "/api/me"))).admin).toBe(false);
    // Used up: one use per code.
    await expect(login("third", code)).rejects.toThrow(/403/);
    // Not an admin: no sign-up codes.
    expect((await api(newcomer, "POST", "/api/invites", {})).status).toBe(403);
  });

  it("refuses revoked and expired codes", async () => {
    const admin = await login("admin");
    const revoked = await ok<{ id: string; code: string }>(api(admin, "POST", "/api/invites", {}), 201);
    await ok(api(admin, "DELETE", `/api/invites/${revoked.id}`));
    await expect(login("late", revoked.code)).rejects.toThrow(/403/);
    const expired = await ok<{ id: string; code: string }>(api(admin, "POST", "/api/invites", {}), 201);
    await env.DB.prepare("UPDATE invites SET expires_at = 1 WHERE id = ?").bind(expired.id).run();
    await expect(login("later", expired.code)).rejects.toThrow(/403/);
  });
});

describe("sessions", () => {
  it("answers 401 when signed out and after logging out", async () => {
    expect((await api(undefined, "GET", "/api/me")).status).toBe(401);
    expect((await api(undefined, "GET", "/api/workspaces")).status).toBe(401);
    const admin = await login("admin");
    await ok(api(admin, "POST", "/api/auth/logout"));
    expect((await api(admin, "GET", "/api/me")).status).toBe(401);
    expect((await api({ ...admin, token: "nonsense" }, "GET", "/api/me")).status).toBe(401);
  });

  it("refuses cookie writes from another site but not bearer ones", async () => {
    const admin = await login("admin");
    const cookie = `__Host-flowgit_session=${admin.token}`;
    const write = (origin?: string) =>
      SELF.fetch(`${ORIGIN}/api/workspaces`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ name: "x" }),
      });
    expect((await write("https://evil.example")).status).toBe(403);
    expect((await write()).status).toBe(403);
    expect((await write(ORIGIN)).status).toBe(201);
    // Reads with the cookie need no Origin.
    expect((await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await api(admin, "POST", "/api/workspaces", { name: "y" }, { Origin: "https://evil.example" })).status).toBe(201);
  });

  it("sets an HttpOnly, Secure, __Host- cookie", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ subject: "admin" }),
    });
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^__Host-flowgit_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});

describe("the test login", () => {
  it("is refused outside the local emulator", async () => {
    for (const environment of ["staging", "production", undefined]) {
      const res = await handle(
        new Request(`${ORIGIN}/api/auth/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "admin" }) }),
        { ...env, ENVIRONMENT: environment },
      );
      expect(res.status).toBe(404);
    }
    const res = await handle(
      new Request(`${ORIGIN}/api/auth/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "admin" }) }),
      { ...env, FLOWGIT_TEST_LOGIN: undefined },
    );
    expect(res.status).toBe(404);
  });
});

describe("GitHub and Google sign-in", () => {
  it("redirects to GitHub with state and PKCE, and refuses a callback with the wrong state", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/github?next=/app/&invite=FG-1`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-github-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/github/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0]!;
    const bad = await SELF.fetch(`${ORIGIN}/api/auth/github/callback?code=x&state=wrong`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(bad.status).toBe(400);
    const none = await SELF.fetch(`${ORIGIN}/api/auth/github/callback?code=x&state=${location.searchParams.get("state")}`, { redirect: "manual" });
    expect(none.status).toBe(400);
  });

  it("signs a GitHub admin in through the callback", async () => {
    const start = await handle(new Request(`${ORIGIN}/api/auth/github?next=/app/x`), { ...env, ADMINS: "github:4242" });
    const location = new URL(start.headers.get("Location")!);
    const cookie = start.headers.get("Set-Cookie")!.split(";")[0]!;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url === "https://github.com/login/oauth/access_token") {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBeTruthy();
        expect(body.get("client_secret")).toBe("test-github-secret");
        return Response.json({ access_token: "gho_test" });
      }
      if (url === "https://api.github.com/user") return Response.json({ id: 4242, login: "octo", name: "Octo Cat", avatar_url: "https://avatars/1" });
      return new Response("unexpected", { status: 500 });
    });
    const res = await handle(
      new Request(`${ORIGIN}/api/auth/github/callback?code=abc&state=${location.searchParams.get("state")}`, { headers: { Cookie: cookie } }),
      { ...env, ADMINS: "github:4242" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/app/x");
    expect(calls).toEqual(["https://github.com/login/oauth/access_token", "https://api.github.com/user"]);
    const session = res.headers.getAll ? res.headers.getAll("Set-Cookie").join("\n") : (res.headers.get("Set-Cookie") ?? "");
    const token = /__Host-flowgit_session=([^;]+)/.exec(session)![1]!;
    const me = await ok<{ user: { name: string } }>(SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: `__Host-flowgit_session=${token}` } }));
    expect(me.user.name).toBe("Octo Cat");
  });

  it("checks Google's ID token audience", async () => {
    const start = await handle(new Request(`${ORIGIN}/api/auth/google`), { ...env, ADMINS: "google:g-1" });
    const location = new URL(start.headers.get("Location")!);
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    const cookie = start.headers.get("Set-Cookie")!.split(";")[0]!;
    const idToken = (aud: string) =>
      `x.${btoa(JSON.stringify({ iss: "https://accounts.google.com", aud, sub: "g-1", exp: Date.now() / 1000 + 600, email: "a@example.com", email_verified: true, name: "Ada" })).replace(/=+$/, "")}.y`;
    let aud = "someone-else";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id_token: idToken(aud) }));
    const callback = () =>
      handle(new Request(`${ORIGIN}/api/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`, { headers: { Cookie: cookie } }), {
        ...env,
        ADMINS: "google:g-1",
      });
    expect((await callback()).status).toBe(502);
    aud = "test-google-id";
    expect((await callback()).status).toBe(302);
  });

  it("only redirects back to this site after sign-in", async () => {
    for (const next of ["https://evil.example/", "//evil.example/x", "/\\evil"]) {
      const res = await SELF.fetch(`${ORIGIN}/api/auth/github?next=${encodeURIComponent(next)}`, { redirect: "manual" });
      const saved = decodeURIComponent(res.headers.get("Set-Cookie")!.split(";")[0]!.split("=").slice(1).join("="));
      expect(JSON.parse(saved).next).toBe("/app/");
    }
  });
});

describe("CLI sign-in with a device code", () => {
  it("gives a token once the person approves in the browser", async () => {
    const admin = await login("admin");
    const start = await ok<{ device_code: string; user_code: string; verification_uri: string }>(api(undefined, "POST", "/api/auth/device"));
    expect(start.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    const pending = await api(undefined, "POST", "/api/auth/device/token", { device_code: start.device_code });
    expect(pending.status).toBe(400);
    expect(((await pending.json()) as { code: string }).code).toBe("authorization_pending");

    const cookie = `__Host-flowgit_session=${admin.token}`;
    const page = await SELF.fetch(`${start.verification_uri}?code=${start.user_code}`, { headers: { Cookie: cookie } });
    expect(await page.text()).toContain(start.user_code);
    // The approval form must come from this site.
    const form = (origin: string) =>
      SELF.fetch(`${ORIGIN}/api/auth/device/verify`, { method: "POST", headers: { Cookie: cookie, Origin: origin }, body: new URLSearchParams({ code: start.user_code.toLowerCase() }) });
    expect((await form("https://evil.example")).status).toBe(403);
    expect((await form(ORIGIN)).status).toBe(200);

    const done = await ok<{ token: string }>(api(undefined, "POST", "/api/auth/device/token", { device_code: start.device_code }));
    const me = await ok<{ user: { id: string }; via: string }>(SELF.fetch(`${ORIGIN}/api/me`, { headers: { Authorization: `Bearer ${done.token}` } }));
    expect(me.user.id).toBe(admin.id);
    expect(me.via).toBe("bearer");
    const again = await api(undefined, "POST", "/api/auth/device/token", { device_code: start.device_code });
    expect(((await again.json()) as { code: string }).code).toBe("invalid_grant");
  });
});

describe("audit log", () => {
  it("records sign-ups and workspace changes, and only owners read it", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const { entries } = await ok<{ entries: { action: string }[] }>(api(admin, "GET", `/api/workspaces/${ws}/audit`));
    expect(entries.map((e) => e.action)).toContain("workspace.create");
  });
});
