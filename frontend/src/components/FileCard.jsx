import { useState } from "react";
import { formatBytes, formatDate, typeLabel } from "../lib/format.js";
import Icon from "./Icon.jsx";

const KINDS = { pdf: "pdf", ppt: "ppt", pptx: "ppt", doc: "doc", docx: "doc", md: "doc", txt: "doc", xls: "xls", xlsx: "xls", csv: "xls", ipynb: "code", png: "img", jpg: "img", jpeg: "img", zip: "zip" };

function fileKind(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return { ext: ext.slice(0, 4).toUpperCase(), kind: KINDS[ext] || "other" };
}

function initials(name) {
  return String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function FileCard({ file, api, onDeleted, onTag }) {
  const [downloads, setDownloads] = useState(file.downloadCount);
  const [busy, setBusy] = useState(null); // "download" | "delete"
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  async function download() {
    setBusy("download");
    setError(null);
    try {
      const result = await api.getDownload(file.fileId);
      setDownloads(result.downloadCount);
      // The link answers with "Content-Disposition: attachment", so the
      // browser saves the file and stays on this page.
      const link = document.createElement("a");
      link.href = result.url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await api.deleteFile(file.fileId);
      onDeleted(file.fileId);
    } catch (failure) {
      setError(failure.message);
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <li className="card" data-type={file.resourceType}>
      <div className="card-top">
        <span className={`filetype ${fileKind(file.fileName).kind}`} aria-hidden="true">{fileKind(file.fileName).ext}</span>
        <span className="when" title={new Date(file.createdAt).toLocaleString()}>{formatDate(file.createdAt)}</span>
      </div>
      <h3>{file.title}</h3>
      <div className="card-head">
        <span className="code">{file.subjectCode}</span>
        <span className="card-kind">{typeLabel(file.resourceType)} · Semester {file.semester}</span>
      </div>
      {file.description && <p className="desc">{file.description}</p>}
      {file.tags.length > 0 && (
        <ul className="tags" aria-label="Tags">
          {file.tags.map((tag) => (
            <li key={tag}><button type="button" className="tag" onClick={() => onTag(tag)} title={`Search for ${tag}`}>{tag}</button></li>
          ))}
        </ul>
      )}
      <p className="uploader">
        <span className="avatar small" aria-hidden="true">{initials(file.uploaderName)}</span>
        <span>{file.isMine ? "You" : file.uploaderName}</span>
      </p>
      <p className="meta">
        <span><Icon name="download" size={15} /> {downloads} {downloads === 1 ? "download" : "downloads"}</span>
        <span title={file.fileName}><Icon name="file" size={15} /> {formatBytes(file.size)}</span>
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="card-actions">
        <button className="button primary" onClick={download} disabled={busy !== null}>
          <Icon name="download" size={17} /> {busy === "download" ? "Preparing…" : "Download"}
        </button>
        {file.canDelete && !confirming && (
          <button className="button quiet danger" onClick={() => setConfirming(true)} disabled={busy !== null}>Delete</button>
        )}
        {confirming && (
          <span className="confirm" role="group" aria-label="Confirm delete">
            Delete for everyone?
            <button className="button danger" onClick={remove} disabled={busy !== null}>{busy === "delete" ? "Deleting…" : "Yes, delete"}</button>
            <button className="button quiet" onClick={() => setConfirming(false)} disabled={busy !== null}>Keep</button>
          </span>
        )}
      </div>
    </li>
  );
}
