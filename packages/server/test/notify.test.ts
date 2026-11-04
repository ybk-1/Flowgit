import { describe, expect, it } from "vitest";
import { pushTransport } from "../src/notify/notify.js";
import { b64url, encryptPayload, unb64url, vapidAuthorization } from "../src/notify/webpush.js";
import { adminWithWorkspace, api, ok } from "./helpers.js";

// RFC 8291, Appendix A: https://www.rfc-editor.org/rfc/rfc8291#appendix-A
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** The browser's side of RFC 8291: decrypt what the server sent. */
async function decrypt(body: Uint8Array, uaPublic: string, uaPrivate: string, auth: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const point = unb64url(uaPublic);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)), d: uaPrivate };
  const ua = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asPoint = { kty: "EC", crv: "P-256", x: b64url(asPublic.slice(1, 33)), y: b64url(asPublic.slice(33)) };
  const as = await crypto.subtle.importKey("jwk", asPoint, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as } as unknown as SubtleCryptoDeriveKeyAlgorithm, ua, 256));
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...point, ...asPublic]);
  const ikm = await hkdf(unb64url(auth), secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("Web Push", () => {
  it("encrypts exactly like RFC 8291's example", async () => {
    const body = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(RFC.plaintext), {
      salt: unb64url(RFC.salt),
      serverPublic: unb64url(RFC.asPublic),
      serverPrivate: unb64url(RFC.asPrivate),
    });
    expect(b64url(body)).toBe(RFC.body);
    expect(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.auth)).toBe(RFC.plaintext);
  });

  it("signs a VAPID token the push service can check", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const publicKey = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateKey: jwk.d!, subject: "mailto:a@b.c" }, 1_800_000_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(match[4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(unb64url(match[2]!)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:a@b.c" });
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, unb64url(match[3]!), new TextEncoder().encode(`${match[1]}.${match[2]}`));
    expect(valid).toBe(true);
  });

  it("stores browser push subscriptions only, and pushes each notification to them", async () => {
    const { admin } = await adminWithWorkspace();
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer));
    const uaPrivate = ((await crypto.subtle.exportKey("jwk", ua.privateKey)) as JsonWebKey).d!;
    const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
    for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url"]) {
      expect((await api(admin, "POST", "/api/push/subscriptions", { endpoint, keys: { p256dh, auth } })).status, endpoint).toBe(400);
    }
    const endpoint = "https://fcm.googleapis.com/fcm/send/test-device";
    await ok(api(admin, "POST", "/api/push/subscriptions", { endpoint, keys: { p256dh, auth } }));
    const { publicKey } = await ok<{ publicKey: string }>(api(undefined, "GET", "/api/push/key"));
    expect(publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);

    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    pushTransport.fetch = async (input, init) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers), body: new Uint8Array(init!.body as Uint8Array) });
      return new Response(null, { status: 201 });
    };
    try {
      const { notify } = await import("../src/notify/notify.js");
      const { env } = await import("cloudflare:test");
      await notify(env, { userId: admin.id, kind: "run.done", title: "Done", body: "all stages" });
    } finally {
      pushTransport.fetch = undefined;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(endpoint);
    expect(sent[0]!.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(sent[0]!.headers.get("Authorization")).toMatch(/^vapid t=.+, k=B/);
    const message = JSON.parse(await decrypt(sent[0]!.body, p256dh, uaPrivate, auth));
    expect(message).toMatchObject({ kind: "run.done", title: "Done", body: "all stages" });

    const list = await ok<{ notifications: { id: string }[]; unread: number }>(api(admin, "GET", "/api/notifications"));
    expect(list.unread).toBe(1);
    await ok(api(admin, "POST", "/api/notifications/read", {}));
    expect((await ok<{ unread: number }>(api(admin, "GET", "/api/notifications"))).unread).toBe(0);

    // A gone subscription is dropped.
    pushTransport.fetch = async () => new Response(null, { status: 410 });
    try {
      const { notify } = await import("../src/notify/notify.js");
      const { env } = await import("cloudflare:test");
      await notify(env, { userId: admin.id, kind: "run.failed", title: "x", body: "y" });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").bind(admin.id).first("n")).toBe(0);
    } finally {
      pushTransport.fetch = undefined;
    }
  });
});
