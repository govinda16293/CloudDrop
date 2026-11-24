import { useState } from "react";
import { formatBytes, formatDate, typeLabel } from "../lib/format.js";

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
      <div className="card-head">
        <span className="code">{file.subjectCode}</span>
        <span>{typeLabel(file.resourceType)}</span>
        <span className="sem">Sem {file.semester}</span>
      </div>
      <h3>{file.title}</h3>
      {file.description && <p className="desc">{file.description}</p>}
      {file.tags.length > 0 && (
        <ul className="tags" aria-label="Tags">
          {file.tags.map((tag) => (
            <li key={tag}><button type="button" className="tag" onClick={() => onTag(tag)} title={`Search for ${tag}`}>{tag}</button></li>
          ))}
        </ul>
      )}
      <p className="meta">
        <span title={file.fileName} className="filename">{file.fileName}</span>
        <span>{formatBytes(file.size)}</span>
        <span>{file.isMine ? "You" : file.uploaderName}</span>
        <span title={new Date(file.createdAt).toLocaleString()}>{formatDate(file.createdAt)}</span>
        <span>{downloads} {downloads === 1 ? "download" : "downloads"}</span>
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="card-actions">
        <button className="button primary" onClick={download} disabled={busy !== null}>
          {busy === "download" ? "Preparing…" : "Download"}
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
