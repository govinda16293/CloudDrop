import { useState } from "react";
import { SEMESTERS, formatBytes, isSubjectCode, parseTags, typeLabel } from "../lib/format.js";
import { checkFile, titleFromFileName, uploadToStorage } from "../lib/upload.js";

const BLANK = { title: "", subjectCode: "", semester: "", resourceType: "notes", tags: "", description: "" };

export default function UploadView({ api, limits }) {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [stage, setStage] = useState("form"); // form | sending | done
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [shared, setShared] = useState(null);

  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));

  function choose(chosen) {
    setError(checkFile(chosen, limits));
    setFile(chosen || null);
    if (chosen && !form.title) setForm((current) => ({ ...current, title: titleFromFileName(chosen.name).slice(0, 120) }));
  }

  async function submit(event) {
    event.preventDefault();
    const problem =
      checkFile(file, limits) ||
      (!isSubjectCode(form.subjectCode) && "Subject code must look like UCS531.") ||
      (parseTags(form.tags).length > limits.maxTags && `Use at most ${limits.maxTags} tags.`);
    if (problem) return setError(problem);

    setError(null);
    setProgress(0);
    setStage("sending");
    try {
      const created = await api.createUpload({
        title: form.title,
        fileName: file.name,
        size: file.size,
        subjectCode: form.subjectCode.trim(),
        semester: Number(form.semester),
        resourceType: form.resourceType,
        tags: parseTags(form.tags),
        description: form.description,
      });
      if (api.uploadFile) await api.uploadFile(created.upload, file, { onProgress: setProgress });
      else await uploadToStorage(created.upload, file, { onProgress: setProgress });
      setShared(await api.completeUpload(created.file.fileId));
      setStage("done");
    } catch (failure) {
      setError(failure.message);
      setStage("form");
    }
  }

  if (stage === "done") {
    return (
      <div className="empty success">
        <h1>Shared.</h1>
        <p><strong>{shared.title}</strong> is now in the library under <span className="code">{shared.subjectCode}</span>.</p>
        <p className="row">
          <a className="button primary" href="#/library">Open the library</a>
          <button className="button" onClick={() => { setFile(null); setForm(BLANK); setShared(null); setStage("form"); }}>Upload another</button>
        </p>
      </div>
    );
  }

  const sending = stage === "sending";
  const percent = Math.round(progress * 100);
  return (
    <>
      <div className="page-head">
        <h1>Upload <span className="grad">resource</span></h1>
        <p className="muted">Up to {formatBytes(limits.maxFileBytes)}. Allowed: {limits.allowedExtensions.join(" ")}</p>
      </div>
      <form className="upload" onSubmit={submit}>
        <div
          className={`drop${dragging ? " over" : ""}${file ? " has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); if (!sending) choose(event.dataTransfer.files[0]); }}
        >
          <input id="file" type="file" className="visually-hidden" accept={limits.allowedExtensions.join(",")} disabled={sending}
            onChange={(event) => choose(event.target.files[0])} />
          {file ? (
            <p><strong>{file.name}</strong> <span className="muted">{formatBytes(file.size)}</span></p>
          ) : (
            <p><strong>Drag &amp; drop your file here</strong><br /><span className="muted">or</span></p>
          )}
          <label htmlFor="file" className="button">{file ? "Choose a different file" : "Choose a file"}</label>
        </div>

        <label className="field">
          <span>Title</span>
          <input type="text" required minLength={3} maxLength={120} value={form.title} onChange={set("title")} disabled={sending} placeholder="Unit 3 notes - Virtualization" />
        </label>
        <div className="row">
          <label className="field">
            <span>Subject code</span>
            <input type="text" className="mono" required maxLength={7} value={form.subjectCode} onChange={set("subjectCode")} disabled={sending} placeholder="UCS531" />
          </label>
          <label className="field">
            <span>Semester</span>
            <select required value={form.semester} onChange={set("semester")} disabled={sending}>
              <option value="" disabled>Choose</option>
              {SEMESTERS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={form.resourceType} onChange={set("resourceType")} disabled={sending}>
              {limits.resourceTypes.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Tags <em>optional</em></span>
          <input type="text" value={form.tags} onChange={set("tags")} disabled={sending} placeholder="virtualization, hypervisor, unit 3" />
          <small>Separate with commas. Up to {limits.maxTags}.</small>
        </label>
        <label className="field">
          <span>Description <em>optional</em></span>
          <textarea rows={3} maxLength={500} value={form.description} onChange={set("description")} disabled={sending} />
        </label>

        {error && <p className="notice error" role="alert">{error}</p>}
        {sending && (
          <div className="progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        <button className="button primary" disabled={sending}>{sending ? `Uploading… ${percent}%` : "Share with campus"}</button>
      </form>
    </>
  );
}
