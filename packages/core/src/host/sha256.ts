import type { HostHash } from "./types.js";

// Synchronous SHA-256 (FIPS 180-4) for hosts without node:crypto. Web Crypto's
// digest() is async, and core hashes inside synchronous calls such as status().

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const encoder = new TextEncoder();

export function sha256(): HostHash {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const block = new Uint8Array(64);
  let blockLen = 0;
  let total = 0;
  let done = false;

  const compress = (b: Uint8Array) => {
    for (let i = 0; i < 16; i++) w[i] = (b[i * 4]! << 24) | (b[i * 4 + 1]! << 16) | (b[i * 4 + 2]! << 8) | b[i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
      const maj = (a! & bb!) ^ (a! & c!) ^ (bb! & c!);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d! + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a!) | 0; h[1] = (h[1]! + bb!) | 0; h[2] = (h[2]! + c!) | 0; h[3] = (h[3]! + d!) | 0;
    h[4] = (h[4]! + e!) | 0; h[5] = (h[5]! + f!) | 0; h[6] = (h[6]! + g!) | 0; h[7] = (h[7]! + hh!) | 0;
  };

  const api: HostHash = {
    update(data) {
      if (done) throw new Error("digest() already called");
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      total += bytes.length;
      let i = 0;
      while (i < bytes.length) {
        const n = Math.min(64 - blockLen, bytes.length - i);
        block.set(bytes.subarray(i, i + n), blockLen);
        blockLen += n;
        i += n;
        if (blockLen === 64) {
          compress(block);
          blockLen = 0;
        }
      }
      return api;
    },
    digest() {
      done = true;
      const bits = total * 8;
      block[blockLen++] = 0x80;
      if (blockLen > 56) {
        block.fill(0, blockLen);
        compress(block);
        blockLen = 0;
      }
      block.fill(0, blockLen, 56);
      const view = new DataView(block.buffer);
      view.setUint32(56, Math.floor(bits / 0x100000000));
      view.setUint32(60, bits >>> 0);
      compress(block);
      return Array.from(h, (x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
    },
  };
  return api;
}
