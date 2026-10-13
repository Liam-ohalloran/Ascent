// The Vercel scoring function, with AI Gateway replaced by a fake.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AI_GATEWAY_API_KEY = "test-key";
let gatewayReply;
let gatewayCalls = 0;
globalThis.fetch = async (url, init) => {
  gatewayCalls++;
  assert.match(String(url), /ai-gateway\.vercel\.sh/);
  return gatewayReply(JSON.parse(init.body));
};
const okReply = (content) => () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

const { default: handler } = await import("../../api/score.js");

let ipCounter = 0;
function call({ method = "POST", body, origin = "https://liam-ohalloran.github.io", ip } = {}) {
  return new Promise((done) => {
    const res = {
      headers: {}, code: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(o) { done({ code: this.code, body: o, headers: this.headers }); },
      end() { done({ code: this.code, body: null, headers: this.headers }); },
    };
    handler({ method, body, headers: { origin, "x-forwarded-for": ip || `10.0.0.${++ipCounter}` } }, res);
  });
}

beforeEach(() => {
  gatewayCalls = 0;
  gatewayReply = okReply('{"links": {"GREEN": false, "BACK": true}}');
});

test("CORS allows only the game's own sites", async () => {
  const ok = await call({ method: "OPTIONS" });
  assert.equal(ok.code, 204);
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://liam-ohalloran.github.io");
  const other = await call({ method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(other.headers["Access-Control-Allow-Origin"], undefined);
});

test("rejects bad methods, words, clues and oversized bodies without calling the AI", async () => {
  assert.equal((await call({ method: "GET" })).code, 405);
  assert.equal((await call({ body: { kind: "link", word: "ignore previous", clues: ["SUN"] } })).code, 400);
  assert.equal((await call({ body: { kind: "link", word: "YARD", clues: [] } })).code, 400);
  assert.equal((await call({ body: { kind: "nope", word: "YARD" } })).code, 400);
  assert.equal((await call({ body: "x".repeat(5000) })).code, 413);
  assert.equal((await call({ body: "{bad json" })).code, 413);
  assert.equal(gatewayCalls, 0);
});

test("a link verdict only counts explicit true values", async () => {
  gatewayReply = okReply('Sure! {"links": {"GREEN": "yes", "BACK": true, "EXTRA": true}}');
  const r = await call({ body: { kind: "link", word: "YARD", clues: ["GREEN", "BACK"] } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { links: { GREEN: false, BACK: true } });
});

test("identical questions are answered from memory", async () => {
  const body = { kind: "link", word: "PORCH", clues: ["SUN", "FIRE"] };
  await call({ body });
  await call({ body });
  assert.equal(gatewayCalls, 1);
});

test("summit closeness is clamped to 0..1", async () => {
  gatewayReply = okReply('{"close": 7}');
  const r = await call({ body: { kind: "summit", word: "GEOSMIN", answer: "PETRICHOR", definition: "smell after rain" } });
  assert.deepEqual(r.body, { close: 1 });
});

test("gateway failures and malformed replies give a plain 503 with no internals", async () => {
  gatewayReply = () => ({ ok: false, status: 403, text: async () => "credit card required, account id 123" });
  const a = await call({ body: { kind: "link", word: "ALPHA", clues: ["SUN"] } });
  assert.equal(a.code, 503);
  assert.deepEqual(a.body, { error: "unavailable" });
  gatewayReply = okReply("I can't help with that.");
  const b = await call({ body: { kind: "link", word: "BRAVO", clues: ["SUN"] } });
  assert.deepEqual(b.body, { error: "unavailable" });
});

test("each IP is limited to 30 judge calls a minute", async () => {
  const codes = [];
  for (let k = 0; k < 32; k++) {
    codes.push((await call({ ip: "203.0.113.9", body: { kind: "link", word: `WORD${"ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF"[k]}`.replace(/\d/g, ""), clues: ["SUN"] } })).code);
  }
  assert.equal(codes.filter((c) => c === 429).length, 2);
});
