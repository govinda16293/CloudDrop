export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function buildQuery(params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params || {})) {
    if (value === true) query.set(name, "1");
    else if (value !== undefined && value !== null && value !== "" && value !== false) query.set(name, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function signedOut() {
  return new ApiError(401, "unauthorized", "Your session has ended. Sign in again.");
}

async function errorFrom(response) {
  let body = null;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = null;
  }
  // Our Lambdas answer {error: {code, message}}; API Gateway itself answers {message}.
  const message = body?.error?.message || body?.message;
  if (message) return new ApiError(response.status, body?.error?.code || "error", message);
  return new ApiError(response.status, "error", `The server had a problem (${response.status}). Try again.`);
}

// fetchImpl is wrapped, not `= fetch`: a bare reference loses its `this` and
// browsers throw "Illegal invocation" when it is called.
export function createApi({ apiBase, getToken, onUnauthorized, fetchImpl = (...args) => fetch(...args) }) {
  async function request(method, path, body) {
    let token;
    try {
      token = await getToken();
    } catch (failure) {
      throw new ApiError(0, "network", failure.message);
    }
    if (!token) {
      onUnauthorized();
      throw signedOut();
    }
    // The bare token, with no "Bearer " in front: that is the form API
    // Gateway's Cognito authorizer documents.
    const options = { method, headers: { Authorization: token } };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, options);
    } catch {
      throw new ApiError(0, "network", "Can't reach the server. Check your connection.");
    }
    if (response.status === 401) {
      onUnauthorized();
      throw signedOut();
    }
    if (!response.ok) throw await errorFrom(response);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  const id = (fileId) => encodeURIComponent(fileId);
  return {
    me: () => request("GET", "/me"),
    listFiles: (params) => request("GET", `/files${buildQuery(params)}`),
    createUpload: (payload) => request("POST", "/files", payload),
    completeUpload: (fileId) => request("POST", `/files/${id(fileId)}/complete`),
    getDownload: (fileId) => request("GET", `/files/${id(fileId)}/download`),
    deleteFile: (fileId) => request("DELETE", `/files/${id(fileId)}`),
    adminStats: () => request("GET", "/admin/stats"),
    // The REST API has no summary route; walk a few pages of the list instead.
    async summary() {
      const files = [];
      let cursor = null;
      for (let page = 0; page < 5; page += 1) {
        const result = await request("GET", `/files${buildQuery({ limit: 50, cursor })}`);
        files.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      const counts = files.reduce((all, file) => ({ ...all, [file.subjectCode]: (all[file.subjectCode] || 0) + 1 }), {});
      const subjects = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return {
        files: files.length,
        subjects: subjects.length,
        downloads: files.reduce((sum, file) => sum + (file.downloadCount || 0), 0),
        topSubjects: subjects.slice(0, 6).map(([code, count]) => ({ code, files: count })),
      };
    },
  };
}

const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxTags: 8,
  allowedExtensions: [".pdf", ".doc", ".docx", ".ppt", ".pptx"],
  resourceTypes: ["notes", "lab-manual", "question-paper", "slides", "other"],
};

function supabaseError(error, fallback) {
  return new ApiError(400, "supabase", error?.message || fallback);
}

function toFile(row, userId) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    fileId: row.id,
    title: row.title,
    fileName: row.file_name,
    size: Number(row.size),
    subjectCode: row.subject_code,
    semester: row.semester,
    resourceType: row.resource_type,
    tags: row.tags || [],
    description: row.description || "",
    uploaderName: profile?.full_name || "Campus contributor",
    createdAt: row.created_at,
    downloadCount: row.download_count || 0,
    isMine: row.uploader_id === userId,
    canDelete: row.uploader_id === userId,
  };
}

export function createSupabaseApi(client) {
  let pending = new Map();

  async function user() {
    // getSession reads local storage immediately. getUser performs a network
    // request, which left signed-out visitors on the loading screen whenever
    // their network blocked the Auth endpoint.
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.user) throw signedOut();
    return data.session.user;
  }

  async function filesQuery() {
    const { data, error } = await client
      .from("files")
      .select("*, profiles!files_uploader_id_fkey(full_name)")
      .order("created_at", { ascending: false });
    if (error) throw supabaseError(error, "Could not load files.");
    return data;
  }

  return {
    supportsPreview: true,
    async me() {
      const current = await user();
      const { data: profile, error } = await client
        .from("profiles")
        .select("full_name, email, is_admin")
        .eq("id", current.id)
        .single();
      if (error) throw supabaseError(error, "Could not load your profile.");
      return {
        user: { id: current.id, email: profile.email, name: profile.full_name, isAdmin: profile.is_admin },
        limits: LIMITS,
      };
    },
    async listFiles({ q = "", subject = "", semester = "", type = "", mine = false, saved = false, sort = "newest", limit = 12, cursor = null }) {
      const current = await user();
      let rows = await filesQuery();
      if (saved) {
        const ids = new Set(await this.savedIds());
        rows = rows.filter((row) => ids.has(row.id));
      }
      const search = q.trim().toLowerCase();
      rows = rows.filter((row) => (
        (!mine || row.uploader_id === current.id) &&
        (!subject || row.subject_code === subject) &&
        (!semester || String(row.semester) === String(semester)) &&
        (!type || row.resource_type === type) &&
        (!search || [row.title, row.file_name, row.description, ...(row.tags || []), row.profiles?.full_name]
          .filter(Boolean).some((value) => value.toLowerCase().includes(search)))
      ));
      if (sort === "downloads") rows = [...rows].sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
      if (sort === "title") rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));
      const start = Number(cursor || 0);
      const page = rows.slice(start, start + limit).map((row) => toFile(row, current.id));
      const next = start + limit < rows.length ? String(start + limit) : null;
      return { items: page, nextCursor: next };
    },
    async createUpload(payload) {
      const current = await user();
      const fileId = crypto.randomUUID();
      const storagePath = `${current.id}/${fileId}/${payload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      pending.set(fileId, { ...payload, fileId, storagePath, uploaderId: current.id });
      return { file: { fileId }, upload: { storagePath } };
    },
    async uploadFile(upload, file, { onProgress } = {}) {
      onProgress?.(0.2);
      const { error } = await client.storage.from("resources").upload(upload.storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (error) throw supabaseError(error, "Could not upload the file.");
      onProgress?.(0.9);
    },
    async completeUpload(fileId) {
      const item = pending.get(fileId);
      if (!item) throw new ApiError(400, "upload_missing", "That upload has expired. Please start again.");
      const { data, error } = await client
        .from("files")
        .insert({
          id: item.fileId, title: item.title, file_name: item.fileName,
          content_type: "application/octet-stream", size: item.size,
          subject_code: item.subjectCode.toUpperCase(), semester: item.semester,
          resource_type: item.resourceType, tags: item.tags, description: item.description || "",
          uploader_id: item.uploaderId, storage_path: item.storagePath,
        })
        .select("*, profiles!files_uploader_id_fkey(full_name)")
        .single();
      pending.delete(fileId);
      if (error) {
        await client.storage.from("resources").remove([item.storagePath]);
        throw supabaseError(error, "Could not save file details.");
      }
      const current = await user();
      return toFile(data, current.id);
    },
    async getDownload(fileId, { preview = false } = {}) {
      const { data: row, error: fileError } = await client.from("files").select("storage_path, download_count").eq("id", fileId).single();
      if (fileError) throw supabaseError(fileError, "Could not find that file.");
      const { data, error } = await client.storage.from("resources").createSignedUrl(row.storage_path, 300, preview ? {} : { download: true });
      if (error) throw supabaseError(error, "Could not prepare the download.");
      // Counting needs the increment_download database function (supabase/schema.sql):
      // students may not update other people's rows directly.
      const { data: counted, error: countError } = await client.rpc("increment_download", { file_id: fileId });
      const downloadCount = countError ? row.download_count || 0 : Number(counted);
      return { url: data.signedUrl, downloadCount };
    },
    // ---- saved files ----
    async savedIds() {
      const { data, error } = await client.from("bookmarks").select("file_id");
      if (error) return [];
      return data.map((row) => row.file_id);
    },
    async setSaved(fileId, saved) {
      const current = await user();
      const { error } = saved
        ? await client.from("bookmarks").insert({ user_id: current.id, file_id: fileId })
        : await client.from("bookmarks").delete().eq("user_id", current.id).eq("file_id", fileId);
      if (error && error.code !== "23505") throw supabaseError(error, "Could not update your saved files.");
    },

    // ---- reports ----
    async reportFile(fileId, reason) {
      const current = await user();
      const { error } = await client.from("reports").insert({ file_id: fileId, reporter_id: current.id, reason });
      if (error?.code === "23505") throw new ApiError(409, "already_reported", "You have already reported this file.");
      if (error) throw supabaseError(error, "Could not send the report.");
    },
    async listReports() {
      const { data, error } = await client
        .from("reports")
        .select("id, reason, status, created_at, file_id, files(title, subject_code, storage_path)")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw supabaseError(error, "Could not load reports.");
      return data.map((row) => ({
        id: row.id, reason: row.reason, createdAt: row.created_at, fileId: row.file_id,
        title: row.files?.title || "Deleted file", subjectCode: row.files?.subject_code || "",
      }));
    },
    async resolveReport(reportId, { removeFile = false, fileId } = {}) {
      if (removeFile) await this.deleteFile(fileId);
      const { error } = await client.from("reports").update({ status: removeFile ? "removed" : "dismissed" }).eq("id", reportId);
      // A removed file takes its reports with it (on delete cascade), so a missing row is fine.
      if (error && !removeFile) throw supabaseError(error, "Could not update the report.");
    },

    // ---- activity log ----
    async activity(limit = 15) {
      const { data, error } = await client.from("activity").select("id, kind, file_title, actor_id, created_at").order("created_at", { ascending: false }).limit(limit);
      if (error) throw supabaseError(error, "Could not load activity.");
      const ids = [...new Set(data.map((row) => row.actor_id).filter(Boolean))];
      const { data: people } = ids.length ? await client.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const names = Object.fromEntries((people || []).map((person) => [person.id, person.full_name]));
      return data.map((row) => ({ id: row.id, kind: row.kind, title: row.file_title, who: names[row.actor_id] || "Someone", at: row.created_at }));
    },

    // ---- live updates ----
    subscribe(onChange) {
      const channel = client
        .channel("files-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "files" }, (change) => onChange(change.eventType, change.new?.title || change.old?.title))
        .subscribe();
      return () => client.removeChannel(channel);
    },

    async summary() {
      const rows = await filesQuery();
      const subjects = Object.entries(rows.reduce((counts, row) => {
        counts[row.subject_code] = (counts[row.subject_code] || 0) + 1;
        return counts;
      }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return {
        files: rows.length,
        subjects: subjects.length,
        downloads: rows.reduce((sum, row) => sum + (row.download_count || 0), 0),
        topSubjects: subjects.slice(0, 6).map(([code, files]) => ({ code, files })),
      };
    },
    async deleteFile(fileId) {
      const { data: row, error: findError } = await client.from("files").select("storage_path").eq("id", fileId).single();
      if (findError) throw supabaseError(findError, "Could not find that file.");
      const { error: storageError } = await client.storage.from("resources").remove([row.storage_path]);
      if (storageError) throw supabaseError(storageError, "Could not delete the file.");
      const { error } = await client.from("files").delete().eq("id", fileId);
      if (error) throw supabaseError(error, "Could not delete the file record.");
    },
    async adminStats() {
      const rows = await filesQuery();
      const group = (key) => Object.values(rows.reduce((result, row) => {
        const label = row[key];
        result[label] = result[label] || { [key === "subject_code" ? "subjectCode" : key === "resource_type" ? "resourceType" : "semester"]: label, files: 0, downloads: 0 };
        result[label].files += 1;
        result[label].downloads += row.download_count || 0;
        return result;
      }, {}));
      const current = await user();
      const mapped = rows.map((row) => toFile(row, current.id));
      return {
        generatedAt: new Date().toISOString(),
        totals: { files: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.size), 0), downloads: rows.reduce((sum, row) => sum + (row.download_count || 0), 0), uploaders: new Set(rows.map((row) => row.uploader_id)).size },
        platform: { available: false, periodHours: 24 },
        bySubject: group("subject_code"), byType: group("resource_type"), bySemester: group("semester"),
        topDownloads: [...mapped].sort((a, b) => b.downloadCount - a.downloadCount).slice(0, 5),
        recentUploads: mapped.slice(0, 5),
      };
    },
  };
}
