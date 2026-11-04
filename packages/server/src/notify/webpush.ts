/**
 * Web Push from the server, with nothing but WebCrypto:
 * - the message is encrypted for the browser with RFC 8291 ("aes128gcm",
 *   https://www.rfc-editor.org/rfc/rfc8291) using the content coding of RFC 8188
 *   (https://www.rfc-editor.org/rfc/rfc8188);
 * - the push service learns who sends it from a VAPID token, RFC 8292
 *   (https://www.rfc-editor.org/rfc/rfc8292): an ES256 JWT signed with the server's key pair.
 *
 * Keys: VAPID_PUBLIC_KEY is the uncompressed P-256 point (65 bytes) and VAPID_PRIVATE_KEY the
 * private scalar (32 bytes), both base64url, the format `npx web-push generate-vapid-keys` prints.
 * VAPID_SUBJECT is a mailto: or https: contact for the push services.
 */

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A P-256 key as a JWK, from the uncompressed public point and (for a private key) the scalar. */
function p256Jwk(publicPoint: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (publicPoint.length !== 65 || publicPoint[0] !== 4) throw new Error("不是 P-256 公钥 / not an uncompressed P-256 public key");
  return {
    kty: "EC",
    crv: "P-256",
    x: b64url(publicPoint.slice(1, 33)),
    y: b64url(publicPoint.slice(33, 65)),
    ...(d ? { d: b64url(d) } : {}),
    ext: true,
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

export interface PushSubscriptionKeys {
  /** The browser's P-256 public key, base64url (PushSubscription.getKey("p256dh")). */
  p256dh: string;
  /** 16 bytes, base64url (PushSubscription.getKey("auth")). */
  auth: string;
}

/** For the RFC's test vector; normal calls make fresh ones. */
export interface EncryptFixed {
  salt: Uint8Array;
  serverPublic: Uint8Array;
  serverPrivate: Uint8Array;
}

/** RFC 8291 §3.4: one record, the whole message. */
export async function encryptPayload(keys: PushSubscriptionKeys, payload: Uint8Array, fixed?: EncryptFixed): Promise<Uint8Array> {
  const uaPublic = unb64url(keys.p256dh);
  const authSecret = unb64url(keys.auth);
  if (authSecret.length !== 16) throw new Error("auth 要是 16 字节 / auth must be 16 bytes");
  const uaKey = await crypto.subtle.importKey("jwk", p256Jwk(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (fixed) {
    asPublic = fixed.serverPublic;
    asPrivate = await crypto.subtle.importKey("jwk", p256Jwk(fixed.serverPublic, fixed.serverPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256));
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  // The last (and only) record ends with the delimiter 0x02 and no padding.
  const plain = concat(payload, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plain));
  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** RFC 8292 §2: `Authorization: vapid t=<JWT>, k=<public key>`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // At most 24 hours ahead (§2).
  const claims = b64url(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signingKey = await crypto.subtle.importKey("jwk", p256Jwk(unb64url(keys.publicKey), unb64url(keys.privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto's ECDSA signature is r || s, which is what JWS ES256 wants (RFC 7518 §3.4).
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

export interface PushTarget extends PushSubscriptionKeys {
  endpoint: string;
}

/** Send one message. Answers the push service's status: 201 sent, 404 / 410 the subscription is gone. */
export async function sendPush(target: PushTarget, payload: unknown, keys: VapidKeys, fetcher: typeof fetch = fetch): Promise<number> {
  const endpoint = new URL(target.endpoint);
  if (endpoint.protocol !== "https:") return 400;
  const body = await encryptPayload(target, encoder.encode(JSON.stringify(payload)));
  const res = await fetcher(endpoint.href, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(endpoint.href, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "normal",
    },
    body,
    redirect: "manual",
  });
  await res.body?.cancel();
  return res.status;
}
