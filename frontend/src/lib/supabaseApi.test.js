import { describe, expect, it, vi } from "vitest";
import { createSupabaseApi } from "./api.js";

// A small stand-in for the Supabase client: each table answers from `tables`,
// and every call is recorded so tests can check what was asked for.
function fakeClient(tables = {}, { errors = {}, rpc = null } = {}) {
  const calls = [];
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
  function query(table) {
    const record = { table, ops: [] };
    calls.push(record);
    const result = () => ({ data: tables[table] ?? [], error: errors[table] ?? null });
    const builder = {
      then: (resolve) => resolve(result()),
      single: async () => ({ data: (tables[table] ?? [])[0], error: errors[table] ?? null }),
    };
    for (const op of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
      builder[op] = (...args) => { record.ops.push([op, ...args]); return builder; };
    }
    return builder;
  }
  return {
    calls,
    channel,
    auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } }, error: null }) },
    from: query,
    rpc: async (...args) => { calls.push({ rpc: args }); return rpc ?? { data: null, error: { message: "missing" } }; },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }), remove: async () => ({ error: null }) }) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
}

const file = (id, title, extra = {}) => ({ id, title, file_name: `${id}.pdf`, size: 10, subject_code: "UCS531", semester: 5, resource_type: "notes", tags: [], uploader_id: "other", created_at: "2026-11-01T00:00:00Z", download_count: 0, profiles: { full_name: "Asha" }, ...extra });

describe("Supabase API: saved files", () => {
  it("lists only saved files when asked", async () => {
    const client = fakeClient({ files: [file("a", "Alpha"), file("b", "Beta")], bookmarks: [{ file_id: "b" }] });
    const page = await createSupabaseApi(client).listFiles({ saved: true });
    expect(page.items.map((item) => item.title)).toEqual(["Beta"]);
  });

  it("returns no saved ids when the bookmarks table is missing", async () => {
    const client = fakeClient({}, { errors: { bookmarks: { message: "relation does not exist" } } });
    expect(await createSupabaseApi(client).savedIds()).toEqual([]);
  });

  it("inserts for save and deletes for unsave, scoped to the signed-in user", async () => {
    const client = fakeClient();
    const api = createSupabaseApi(client);
    await api.setSaved("f1", true);
    await api.setSaved("f1", false);
    const [save, unsave] = client.calls.filter((call) => call.table === "bookmarks");
    expect(save.ops[0]).toEqual(["insert", { user_id: "me", file_id: "f1" }]);
    expect(unsave.ops.map((op) => op[0])).toEqual(["delete", "eq", "eq"]);
  });
});

describe("Supabase API: reports", () => {
  it("explains a second report of the same file", async () => {
    const client = fakeClient({}, { errors: { reports: { code: "23505", message: "duplicate key" } } });
    await expect(createSupabaseApi(client).reportFile("f1", "broken")).rejects.toThrow("already reported");
  });

  it("maps open reports for the admin queue", async () => {
    const client = fakeClient({ reports: [{ id: "r1", reason: "broken", status: "open", created_at: "2026-11-02T00:00:00Z", file_id: "f1", files: { title: "Unit 3", subject_code: "UCS531" } }] });
    const [report] = await createSupabaseApi(client).listReports();
    expect(report).toMatchObject({ id: "r1", title: "Unit 3", subjectCode: "UCS531", reason: "broken" });
  });
});

describe("Supabase API: downloads, activity and live updates", () => {
  it("uses the counted value from increment_download", async () => {
    const client = fakeClient({ files: [{ storage_path: "x", download_count: 4 }] }, { rpc: { data: 5, error: null } });
    expect((await createSupabaseApi(client).getDownload("f1")).downloadCount).toBe(5);
  });

  it("keeps the stored count when the counter function is not installed", async () => {
    const client = fakeClient({ files: [{ storage_path: "x", download_count: 4 }] });
    expect((await createSupabaseApi(client).getDownload("f1")).downloadCount).toBe(4);
  });

  it("names the person behind each activity row", async () => {
    const client = fakeClient({
      activity: [{ id: 1, kind: "upload", file_title: "Unit 3", actor_id: "u1", created_at: "2026-11-03T00:00:00Z" }],
      profiles: [{ id: "u1", full_name: "Asha" }],
    });
    const [row] = await createSupabaseApi(client).activity();
    expect(row).toMatchObject({ kind: "upload", title: "Unit 3", who: "Asha" });
  });

  it("subscribes to file changes and unsubscribes on cleanup", () => {
    const client = fakeClient();
    const onChange = vi.fn();
    const stop = createSupabaseApi(client).subscribe(onChange);
    const handler = client.channel.mock.results[0].value.on.mock.calls[0][2];
    handler({ eventType: "INSERT", new: { title: "Fresh notes" } });
    expect(onChange).toHaveBeenCalledWith("INSERT", "Fresh notes");
    stop();
    expect(client.removeChannel).toHaveBeenCalled();
  });
});

describe("Supabase API: Cloud Run analyser", () => {
  it("is offered only when an analyser URL is configured", () => {
    expect(createSupabaseApi(fakeClient()).analyzeFile).toBeUndefined();
    expect(typeof createSupabaseApi(fakeClient(), { analyzerUrl: "https://run.example" }).analyzeFile).toBe("function");
  });

  it("posts the PDF with the session token and returns the analysis", async () => {
    const client = fakeClient();
    client.auth.getSession = async () => ({ data: { session: { access_token: "tok" } } });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ pages: 3, words: 900, suggestedTags: ["cloud"], subjectCode: "UCS531" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createSupabaseApi(client, { analyzerUrl: "https://run.example/" }).analyzeFile("pdf-bytes");
    expect(fetchMock).toHaveBeenCalledWith("https://run.example/analyze", expect.objectContaining({ method: "POST", body: "pdf-bytes", headers: expect.objectContaining({ authorization: "Bearer tok" }) }));
    expect(result.pages).toBe(3);
    vi.unstubAllGlobals();
  });

  it("passes on the analyser's error message", async () => {
    const client = fakeClient();
    client.auth.getSession = async () => ({ data: { session: { access_token: "tok" } } });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 415, json: async () => ({ error: "Only PDF files can be analysed." }) }));
    await expect(createSupabaseApi(client, { analyzerUrl: "https://run.example" }).analyzeFile("x")).rejects.toThrow("Only PDF");
    vi.unstubAllGlobals();
  });
});
