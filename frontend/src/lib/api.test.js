import { describe, expect, it, vi } from "vitest";
import { ApiError, buildQuery, createApi } from "./api.js";

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}

function setup(responses, overrides = {}) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => queue.shift());
  const onUnauthorized = vi.fn();
  const api = createApi({
    apiBase: "/api",
    getToken: async () => "token-123",
    onUnauthorized,
    fetchImpl,
    ...overrides,
  });
  return { api, fetchImpl, onUnauthorized };
}

describe("buildQuery", () => {
  it("leaves out empty values and encodes the rest", () => {
    expect(buildQuery({ subject: "UCS531", semester: "", q: "unit 3 & 4", mine: false, type: null, limit: 20 })).toBe(
      "?subject=UCS531&q=unit+3+%26+4&limit=20",
    );
  });
  it("turns true into 1", () => expect(buildQuery({ mine: true })).toBe("?mine=1"));
  it("is empty when nothing is set", () => expect(buildQuery({ q: "" })).toBe(""));
});

describe("createApi", () => {
  it("sends the token and returns the parsed body", async () => {
    const { api, fetchImpl } = setup([reply(200, { items: [], nextCursor: null })]);
    const result = await api.listFiles({ subject: "UCS531" });
    expect(result).toEqual({ items: [], nextCursor: null });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/files?subject=UCS531");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("token-123");
  });

  it("posts JSON for a new upload", async () => {
    const { api, fetchImpl } = setup([reply(201, { file: { fileId: "f1" }, upload: {} })]);
    await api.createUpload({ title: "Notes" });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/files");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ title: "Notes" });
  });

  it("builds the right path for each file action", async () => {
    const { api, fetchImpl } = setup([reply(200, {}), reply(200, {}), reply(200, {}), reply(200, {}), reply(200, {})]);
    await api.completeUpload("abc");
    await api.getDownload("abc");
    await api.deleteFile("abc");
    await api.me();
    await api.adminStats();
    expect(fetchImpl.mock.calls.map(([url, o]) => `${o.method} ${url}`)).toEqual([
      "POST /api/files/abc/complete",
      "GET /api/files/abc/download",
      "DELETE /api/files/abc",
      "GET /api/me",
      "GET /api/admin/stats",
    ]);
  });

  it("turns the API's error body into an ApiError with its message", async () => {
    const { api } = setup([reply(400, { error: { code: "validation_error", message: "Semester must be 1 to 8." } })]);
    await expect(api.createUpload({})).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "validation_error",
      message: "Semester must be 1 to 8.",
    });
  });

  it("understands API Gateway's own error shape", async () => {
    const { api } = setup([reply(429, { message: "Too Many Requests" })]);
    await expect(api.me()).rejects.toMatchObject({ status: 429, message: "Too Many Requests" });
  });

  it("gives a plain message when the error body is not JSON", async () => {
    const { api } = setup([{ ok: false, status: 502, text: async () => "<html>Bad Gateway</html>" }]);
    await expect(api.me()).rejects.toMatchObject({ status: 502, message: "The server had a problem (502). Try again." });
  });

  it("signs the user out on a 401", async () => {
    const { api, onUnauthorized } = setup([reply(401, { message: "Unauthorized" })]);
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not sign the user out on a 403", async () => {
    const { api, onUnauthorized } = setup([reply(403, { error: { code: "forbidden", message: "No." } })]);
    await expect(api.adminStats()).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports a network failure in plain words", async () => {
    const { api } = setup([], { fetchImpl: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) });
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: "network", message: "Can't reach the server. Check your connection." });
  });

  it("reports a failure to get the token as a network problem, not a sign-out", async () => {
    const getToken = async () => { throw new Error("Can't reach the sign-in service. Check your connection."); };
    const { api, fetchImpl, onUnauthorized } = setup([], { getToken });
    await expect(api.me()).rejects.toMatchObject({
      name: "ApiError", status: 0, code: "network", message: "Can't reach the sign-in service. Check your connection.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("treats a missing session as signed out without calling the server", async () => {
    const { api, fetchImpl, onUnauthorized } = setup([], { getToken: async () => null });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
