import { useState } from "react";
import { formatBytes, formatDate, typeLabel } from "../lib/format.js";
import Icon from "./Icon.jsx";

const KINDS = { pdf: "pdf", ppt: "ppt", pptx: "ppt", doc: "doc", docx: "doc", md: "doc", txt: "doc", xls: "xls", xlsx: "xls", csv: "xls", ipynb: "code", png: "img", jpg: "img", jpeg: "img", zip: "zip" };

function fileKind(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return { ext: ext.slice(0, 4).toUpperCase(), kind: KINDS[ext] || "other" };
}


export default function FileCard({ file, api, onDeleted, onTag }) {
  const [downloads, setDownloads] = useState(file.downloadCount);
  const [busy, setBusy] = useState(null); // "download" | "delete"
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const previewable = api.supportsPreview && /\.(pdf|png|jpe?g)$/i.test(file.fileName);

  async function preview() {
    setBusy("preview");
    setError(null);
    // Open the tab now: browsers block windows opened after an await.
    const tab = window.open("about:blank", "_blank");
    try {
      const result = await api.getDownload(file.fileId, { preview: true });
      setDownloads(result.downloadCount);
      if (tab) tab.location.href = result.url;
      else window.location.href = result.url;
    } catch (failure) {
      tab?.close();
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

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
    <li className="entry">
      <span className="code">{file.subjectCode}</span>
      <div className="entry-main">
        <h3>{file.title}</h3>
        <p className="entry-sub">
          <span>{typeLabel(file.resourceType)}</span>
          <span>Semester {file.semester}</span>
          <span>{file.isMine ? "You" : file.uploaderName}</span>
          <span title={new Date(file.createdAt).toLocaleString()}>{formatDate(file.createdAt)}</span>
          <span title={file.fileName}>{fileKind(file.fileName).ext} · {formatBytes(file.size)}</span>
          <span>{downloads} {downloads === 1 ? "download" : "downloads"}</span>
        </p>
        {file.description && <p className="desc">{file.description}</p>}
        {file.tags.length > 0 && (
          <ul className="tags" aria-label="Tags">
            {file.tags.map((tag) => (
              <li key={tag}><button type="button" className="tag" onClick={() => onTag(tag)} title={`Search for ${tag}`}>{tag}</button></li>
            ))}
          </ul>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
      </div>
      <div className="entry-actions">
        {previewable && (
          <button className="button quiet" onClick={preview} disabled={busy !== null}>{busy === "preview" ? "Opening…" : "Open"}</button>
        )}
        <button className="button" onClick={download} disabled={busy !== null}>
          <Icon name="download" size={16} /> {busy === "download" ? "Preparing…" : "Download"}
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
