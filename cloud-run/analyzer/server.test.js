const test = require("node:test");
const assert = require("node:assert");
const { suggestTags } = require("./server.js");

test("suggests repeated meaningful terms and skips filler words", () => {
  const text = "Virtual machines and hypervisors. A hypervisor runs virtual machines. Virtual machines share hardware. The the the and and.";
  const tags = suggestTags(text);
  assert.ok(tags.includes("virtual machines"));
  assert.ok(!tags.includes("the"));
});

test("returns nothing for short text", () => {
  assert.deepEqual(suggestTags("cloud"), []);
});

test("HTTP: health check, sign-in required, CORS for the app", async (t) => {
  const { server } = require("./server.js");
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/analyze`, { method: "POST", body: "x" })).status, 401);
  const preflight = await fetch(`${base}/analyze`, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const stranger = await fetch(`${base}/analyze`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(stranger.headers.get("access-control-allow-origin"), null);
});
