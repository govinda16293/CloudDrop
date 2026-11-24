import { describe, expect, it, vi } from "vitest";
import { buildFormData, checkFile, titleFromFileName, uploadToStorage } from "./upload.js";

const limits = { maxFileBytes: 1024 * 1024, allowedExtensions: [".pdf", ".pptx"], resourceTypes: ["notes"], maxTags: 8 };

describe("checkFile", () => {
  it("accepts an allowed file within the size limit", () => {
    expect(checkFile({ name: "Notes.PDF", size: 5000 }, limits)).toBeNull();
  });
  it("needs a file", () => expect(checkFile(null, limits)).toBe("Choose a file to upload."));
  it("rejects an empty file", () => expect(checkFile({ name: "a.pdf", size: 0 }, limits)).toBe("This file is empty."));
  it("rejects a file over the limit and says the limit", () => {
    expect(checkFile({ name: "a.pdf", size: 1024 * 1024 + 1 }, limits)).toBe("This file is too large. The limit is 1 MB.");
  });
  it("rejects a type that is not allowed and lists what is", () => {
    expect(checkFile({ name: "virus.exe", size: 10 }, limits)).toBe("This file type is not allowed. Allowed: .pdf, .pptx");
    expect(checkFile({ name: "noextension", size: 10 }, limits)).toMatch(/not allowed/);
  });
});

describe("titleFromFileName", () => {
  it("drops the extension and turns separators into spaces", () => {
    expect(titleFromFileName("unit3_virtualization-notes.pdf")).toBe("unit3 virtualization notes");
  });
});

describe("buildFormData", () => {
  it("adds every signed field and puts the file last, as S3 requires", () => {
    const form = buildFormData({ key: "pending/f1", policy: "abc", "x-amz-signature": "sig" }, "FILE");
    expect([...form.keys()]).toEqual(["key", "policy", "x-amz-signature", "file"]);
    expect(form.get("key")).toBe("pending/f1");
  });
});

class FakeXhr {
  constructor() {
    this.upload = {};
    FakeXhr.last = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  send(body) {
    this.body = body;
  }
}

describe("uploadToStorage", () => {
  const form = { url: "https://bucket.s3.ap-south-1.amazonaws.com/", fields: { key: "pending/f1" } };

  it("posts the form to the pre-signed address and reports progress", async () => {
    const onProgress = vi.fn();
    const done = uploadToStorage(form, "FILE", { onProgress, Xhr: FakeXhr });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(form.url);
    expect([...xhr.body.keys()]).toEqual(["key", "file"]);
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 200 });
    xhr.status = 204;
    xhr.onload();
    await expect(done).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith(0.25);
  });

  it("fails with a clear message when storage refuses the file", async () => {
    const done = uploadToStorage(form, "FILE", { Xhr: FakeXhr });
    FakeXhr.last.status = 403;
    FakeXhr.last.onload();
    await expect(done).rejects.toThrow("Storage refused the file (403). Try again.");
  });

  it("fails with a clear message when the connection drops", async () => {
    const done = uploadToStorage(form, "FILE", { Xhr: FakeXhr });
    FakeXhr.last.onerror();
    await expect(done).rejects.toThrow("The upload was interrupted. Check your connection and try again.");
  });
});
