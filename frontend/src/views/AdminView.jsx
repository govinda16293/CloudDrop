import { useCallback, useEffect, useState } from "react";
import { formatBytes, formatDate, typeLabel } from "../lib/format.js";
import Icon from "../components/Icon.jsx";

function Tile({ label, value, note, icon }) {
  return (
    <div className="tile">
      {icon && <span className="tile-icon"><Icon name={icon} size={22} /></span>}
      <span className="tile-label">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Bars({ title, rows, empty }) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <table className="bars">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="bar-cell"><span className="bar" style={{ width: `${(row.value / top) * 100}%` }} /></td>
                <td className="num">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FileTable({ title, files, empty, column }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {files.length === 0 ? <p className="muted">{empty}</p> : (
        <table className="list">
          <thead><tr><th>File</th><th>Subject</th><th>By</th><th className="num">{column.label}</th></tr></thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.fileId}>
                <td>{file.title}</td>
                <td><span className="code">{file.subjectCode}</span></td>
                <td>{file.uploaderName}</td>
                <td className="num">{column.value(file)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function AdminView({ api }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.adminStats().then(setStats).catch((failure) => setError(failure.message)).finally(() => setLoading(false));
  }, [api]);

  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <p className="notice error" role="alert">{error}</p>
        <button className="button" onClick={load}>Try again</button>
      </>
    );
  }
  if (!stats) return <p className="muted" aria-live="polite">Loading the dashboard…</p>;

  const { totals, platform } = stats;
  return (
    <>
      <div className="page-head split">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Updated {formatDate(stats.generatedAt)}.</p>
        </div>
        <button className="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="tiles">
        <Tile label="Files" icon="file" value={totals.files} />
        <Tile label="Storage used" icon="database" value={formatBytes(totals.bytes)} />
        <Tile label="Downloads" icon="download" value={totals.downloads} />
        <Tile label="Contributors" icon="users" value={totals.uploaders} />
      </div>

      <section className="panel">
        <h2>Platform, last {platform.periodHours} hours <span className="muted">from CloudWatch</span></h2>
        {platform.available ? (
          <div className="tiles small">
            <Tile label="API requests" value={platform.api.requests} />
            <Tile label="Client errors (4xx)" value={platform.api.errors4xx} />
            <Tile label="Server errors (5xx)" value={platform.api.errors5xx} />
            <Tile label="API latency" value={platform.api.avgLatencyMs === null ? "—" : `${platform.api.avgLatencyMs} ms`} note="average" />
            <Tile label="Lambda runs" value={platform.lambda.invocations} />
            <Tile label="Lambda errors" value={platform.lambda.errors} />
            <Tile label="Lambda duration" value={platform.lambda.avgDurationMs === null ? "—" : `${platform.lambda.avgDurationMs} ms`} note="average" />
          </div>
        ) : (
          <p className="muted">CloudWatch metrics are not available right now.</p>
        )}
      </section>

      <div className="grid-2">
        <Bars title="Files by subject" empty="No files yet." rows={stats.bySubject.map((row) => ({ label: row.subjectCode, value: row.files }))} />
        <Bars title="Files by type" empty="No files yet." rows={stats.byType.map((row) => ({ label: typeLabel(row.resourceType), value: row.files }))} />
        <Bars title="Files by semester" empty="No files yet." rows={stats.bySemester.map((row) => ({ label: `Sem ${row.semester}`, value: row.files }))} />
        <Bars title="Downloads by subject" empty="No downloads yet." rows={stats.bySubject.filter((row) => row.downloads > 0).map((row) => ({ label: row.subjectCode, value: row.downloads }))} />
      </div>

      <div className="grid-2">
        <FileTable title="Most downloaded" files={stats.topDownloads} empty="No downloads yet." column={{ label: "Downloads", value: (file) => file.downloadCount }} />
        <FileTable title="Latest uploads" files={stats.recentUploads} empty="No files yet." column={{ label: "Added", value: (file) => formatDate(file.createdAt) }} />
      </div>
    </>
  );
}
