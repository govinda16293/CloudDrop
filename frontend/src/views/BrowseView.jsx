import { useEffect, useRef, useState } from "react";
import FileCard from "../components/FileCard.jsx";
import Icon from "../components/Icon.jsx";
import { SEMESTERS, isSubjectCode, typeLabel } from "../lib/format.js";

const EMPTY = { q: "", subject: "", semester: "", type: "" };
const PAGE_SIZE = 12;
const SORTS = [["newest", "Newest"], ["downloads", "Most downloaded"], ["title", "Title A–Z"]];

// Filters live in the address (#/library?subject=UCS531&q=unit) so a search can be shared.
function filtersFromHash() {
  const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return { q: query.get("q") || "", subject: query.get("subject") || "", semester: query.get("semester") || "", type: query.get("type") || "" };
}

function sortLocally(items, sort) {
  if (sort === "downloads") return [...items].sort((a, b) => b.downloadCount - a.downloadCount);
  if (sort === "title") return [...items].sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

export default function BrowseView({ api, limits, mine = false }) {
  const [filters, setFilters] = useState(filtersFromHash);
  const [applied, setApplied] = useState(filtersFromHash); // filters after the typing pause
  const [sort, setSort] = useState("newest");
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error | more
  const [error, setError] = useState(null);
  const requestSeq = useRef(0); // lets a slow, older answer be ignored when a newer search has started

  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    const query = new URLSearchParams(Object.entries(applied).filter(([, value]) => value !== "")).toString();
    const next = `#/${mine ? "mine" : "library"}${query ? `?${query}` : ""}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
  }, [applied, mine]);

  useEffect(() => {
    if (!api.summary || mine) return;
    api.summary().then(setSummary).catch(() => setSummary(null));
  }, [api, mine]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  // A half-typed subject code is not applied yet: the list keeps following the
  // other filters and a hint asks for the full code.
  const typedSubject = applied.subject.trim();
  const subject = isSubjectCode(typedSubject) ? typedSubject : "";
  const subjectReady = typedSubject === "" || subject !== "";
  const q = applied.q.trim();
  const { semester, type } = applied;

  useEffect(() => {
    const thisRequest = ++requestSeq.current;
    setState("loading");
    setError(null);
    api
      .listFiles({ q, subject, semester, type, mine, sort: sort === "newest" ? undefined : sort, limit: PAGE_SIZE })
      .then((page) => {
        if (thisRequest !== requestSeq.current) return;
        setItems(sortLocally(page.items, sort));
        setCursor(page.nextCursor);
        setState("ready");
      })
      .catch((failure) => {
        if (thisRequest !== requestSeq.current) return;
        // Clear the previous search's cards and cursor: they do not belong to
        // these filters, and "Load more" would mix the two result sets.
        setItems([]);
        setCursor(null);
        setError(failure.message);
        setState("error");
      });
  }, [api, q, subject, semester, type, mine, sort]);

  async function loadMore() {
    const thisRequest = requestSeq.current;
    setError(null);
    setState("more");
    try {
      const page = await api.listFiles({ q, subject, semester, type, mine, sort: sort === "newest" ? undefined : sort, limit: PAGE_SIZE, cursor });
      if (thisRequest !== requestSeq.current) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setState("ready");
    } catch (failure) {
      if (thisRequest !== requestSeq.current) return;
      setError(failure.message);
      setState("ready");
    }
  }

  const set = (name) => (event) => setFilters((current) => ({ ...current, [name]: event.target.value }));
  const hasFilters = Object.values(filters).some((value) => value !== "");

  return (
    <>
      <div className="page-head split">
        <div>
          <h1>{mine ? "My uploads" : "Library"}</h1>
          <p className="muted">{mine ? "Files you have shared. Only you can delete them." : "Notes, lab manuals, slides and question papers shared by Thapar students."}</p>
          {summary && (
            <p className="figures">
              <span><strong>{summary.files}</strong> files</span>
              <span><strong>{summary.subjects}</strong> subjects</span>
              <span><strong>{summary.downloads}</strong> downloads</span>
            </p>
          )}
        </div>
        <a className="button primary" href="#/upload"><Icon name="upload" size={17} /> Upload</a>
      </div>

      <section className="catalogue">

      <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="field grow searchbox">
          <span className="visually-hidden">Search</span>
          <Icon name="search" />
          <input type="search" value={filters.q} onChange={set("q")} maxLength={60} placeholder="Search notes, subject code, tags or uploader…" />
        </label>
        <label className="field pill">
          <span className="visually-hidden">Subject code</span>
          <input type="text" className="mono" value={filters.subject} onChange={set("subject")} maxLength={7} placeholder="Subject e.g. UCS531" aria-describedby="subject-hint" />
        </label>
        <label className="field pill">
          <span className="visually-hidden">Semester</span>
          <select value={filters.semester} onChange={set("semester")}>
            <option value="">Any semester</option>
            {SEMESTERS.map((n) => <option key={n} value={n}>Semester {n}</option>)}
          </select>
        </label>
        <label className="field pill">
          <span className="visually-hidden">Type</span>
          <select value={filters.type} onChange={set("type")}>
            <option value="">Any type</option>
            {limits.resourceTypes.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
        </label>
        {/* Always rendered: a button that appears on the first keystroke would shove the fields sideways. */}
        <button type="button" className="button quiet" disabled={!hasFilters} onClick={() => setFilters(EMPTY)}>Clear</button>
      </form>
      <p id="subject-hint" className="hint" aria-live="polite">
        {!subjectReady && "Type the full subject code, like UCS531."}
      </p>

      <div className="toolbar">
        {summary?.topSubjects?.length > 0 && (
          <div className="shortcuts" role="group" aria-label="Popular subjects">
            {summary.topSubjects.map(({ code, files }) => (
              <button key={code} type="button" className={`shortcut${filters.subject === code ? " on" : ""}`}
                onClick={() => setFilters((current) => ({ ...current, subject: current.subject === code ? "" : code }))}>
                {code} <span>{files}</span>
              </button>
            ))}
          </div>
        )}
        <div className="toolbar-end">
          <label className="sort">
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {hasFilters && <button type="button" className="button quiet" onClick={copyLink}>{copied ? "Link copied" : "Copy search link"}</button>}
        </div>
      </div>

      {error && <p className="notice error" role="alert">{error}</p>}

      {state === "loading" && <p className="muted" aria-live="polite">Loading files…</p>}

      {state !== "loading" && state !== "error" && items.length === 0 && (
        <div className="empty">
          <h2>{hasFilters ? "Nothing matches" : mine ? "You haven't shared anything yet" : "The library is empty"}</h2>
          <p>{hasFilters ? "Try fewer filters or a different word." : mine ? "Share your first note, lab manual or paper." : "Be the first to add something useful."}</p>
          {hasFilters
            ? <button className="button" onClick={() => setFilters(EMPTY)}>Clear filters</button>
            : <a className="button primary" href="#/upload">Upload a file</a>}
        </div>
      )}

      {items.length > 0 && state !== "loading" && (
        <ul className="entries">
          {items.map((file) => (
            <FileCard
              key={file.fileId}
              file={file}
              api={api}
              onDeleted={(id) => setItems((current) => current.filter((item) => item.fileId !== id))}
              onTag={(tag) => setFilters((current) => ({ ...current, q: tag }))}
            />
          ))}
        </ul>
      )}

      {cursor && state !== "loading" && (
        <p className="more">
          <button className="button" onClick={loadMore} disabled={state === "more"}>{state === "more" ? "Loading…" : "Load more"}</button>
        </p>
      )}
      </section>
    </>
  );
}
