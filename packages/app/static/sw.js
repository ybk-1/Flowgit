/*
 * Shell cache for the web app. The build writes the hash into the cache name
 * and the file list into SHELL. Old caches are deleted on activate.
 *
 * Same-origin GETs of the shell are cache-first. Everything else is left to the
 * network (no respondWith), so API responses, keys, and model-service requests
 * are never cached. Cross-origin requests are never passed to respondWith.
 * https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
 */
const CACHE = "flowgit-shell-__FLOWGIT_BUILD__";
const SHELL = __FLOWGIT_SHELL__;

function shellPath(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return "";
  let rel = url.pathname.slice(scopePath.length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  return SHELL.includes(rel) ? rel : "";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((rel) => new URL(rel, self.registration.scope))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("flowgit-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Cross-origin (model APIs, GitHub, anything else): do not touch the request.
  if (url.origin !== self.location.origin) return;
  const rel = shellPath(url);
  if (!rel) return;
  const cached = new URL(rel, self.registration.scope).href;
  event.respondWith(caches.match(cached).then((hit) => hit || fetch(req)));
});
