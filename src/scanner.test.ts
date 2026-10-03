import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerRequest } from "./scanner";
afterEach(() => vi.unstubAllGlobals());
describe("scanner connection diagnostics", () => {
  it("does not send a request with a missing token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(scannerRequest("https://scanner.example", "")).rejects.toThrow(
      "Paste your scanner access token",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("tests connection without uploading a document", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ready: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      scannerRequest("https://scanner.example", " token "),
    ).resolves.toEqual({ ready: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url.toString()).toBe("https://scanner.example/health");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer token");
  });
  it("explains Safari Load failed without claiming a scan succeeded", async () => {
    vi.stubGlobal("location", { origin: "https://hkai7706.github.io" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Load failed")),
    );
    await expect(
      scannerRequest("https://scanner.example", "token"),
    ).rejects.toThrow("Cannot reach the scanner");
  });
  it("distinguishes a rejected token from connectivity failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        ),
    );
    await expect(
      scannerRequest("https://scanner.example", "token"),
    ).rejects.toThrow("paste it again");
  });
  it("handles HTML error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Gateway error</html>", { status: 502 }),
        ),
    );
    await expect(
      scannerRequest("https://scanner.example", "token"),
    ).rejects.toThrow("unexpected response (502)");
  });
  it("reports unsupported origins explicitly", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Origin not permitted" }, { status: 403 }),
        ),
    );
    await expect(
      scannerRequest("https://scanner.example", "token"),
    ).rejects.toThrow("This page is not allowed");
  });
});
