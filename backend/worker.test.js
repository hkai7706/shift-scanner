import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "./worker.js";
const env = {
  ALLOWED_ORIGIN: "https://personal.example",
  OPENAI_API_KEY: "server-only-test-key",
  SCAN_TOKEN: "personal-test-token",
};
const request = (options = {}) =>
  new Request("https://scanner.example", {
    method: "POST",
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      Authorization: `Bearer ${env.SCAN_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(
      options.body ?? {
        names: ["ゼーリン"],
        page: { data: "data:image/jpeg;base64,YWJj" },
      },
    ),
  });
afterEach(() => vi.unstubAllGlobals());
describe("scanner security and failure behavior", () => {
  it("accepts explicitly configured local preview origins", async () => {
    const origin = "http://localhost:4173";
    const response = await worker.fetch(
      new Request("https://scanner.example", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
      { ...env, ALLOWED_ORIGINS: `${env.ALLOWED_ORIGIN},${origin}` },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
  it("checks configuration and token without contacting the AI provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(
      new Request("https://scanner.example/health", {
        headers: {
          Origin: env.ALLOWED_ORIGIN,
          Authorization: `Bearer ${env.SCAN_TOKEN}`,
        },
      }),
      env,
    );
    expect(await response.json()).toEqual({ ready: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an incorrect health-check token", async () => {
    const response = await worker.fetch(
      new Request("https://scanner.example/health", {
        headers: {
          Origin: env.ALLOWED_ORIGIN,
          Authorization: "Bearer incorrect",
        },
      }),
      env,
    );
    expect(response.status).toBe(401);
  });
  it("rejects unknown origins", async () =>
    expect(
      (
        await worker.fetch(
          request({ headers: { Origin: "https://attacker.example" } }),
          env,
        )
      ).status,
    ).toBe(403));
  it("rejects missing access token", async () =>
    expect(
      (await worker.fetch(request({ headers: { Authorization: "" } }), env))
        .status,
    ).toBe(401));
  it("rejects invalid image inputs", async () =>
    expect(
      (
        await worker.fetch(
          request({
            body: {
              names: ["ゼーリン"],
              page: { data: "https://attacker.example" },
            },
          }),
          env,
        )
      ).status,
    ).toBe(400));
  it("never pretends to scan when credentials missing", async () =>
    expect(
      (await worker.fetch(request(), { ...env, OPENAI_API_KEY: "" })).status,
    ).toBe(503));
  it("returns an honest provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 429 })),
    );
    expect((await worker.fetch(request(), env)).status).toBe(502);
  });
  it("sends server key only upstream and uses untrusted document input", async () => {
    const mock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: JSON.stringify({ shifts: [] }) } }],
      }),
    );
    vi.stubGlobal("fetch", mock);
    const res = await worker.fetch(request(), env);
    expect(await res.json()).toEqual({ shifts: [] });
    const payload = JSON.parse(mock.mock.calls[0][1].body);
    expect(payload.messages[0].content).toContain("untrusted data");
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer server-only-test-key",
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
