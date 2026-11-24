import { useEffect, useRef, useState } from "react";
import FileCard from "../components/FileCard.jsx";
import { SEMESTERS, isSubjectCode, typeLabel } from "../lib/format.js";

const EMPTY = { q: "", subject: "", semester: "", type: "" };
const PAGE_SIZE = 12;

export default function BrowseView({ api, limits, mine = false }) {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY); // filters after the typing pause
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
      .listFiles({ q, subject, semester, type, mine, limit: PAGE_SIZE })
      .then((page) => {
        if (thisRequest !== requestSeq.current) return;
        setItems(page.items);
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
  }, [api, q, subject, semester, type, mine]);

  async function loadMore() {
    const thisRequest = requestSeq.current;
    setError(null);
    setState("more");
    try {
      const page = await api.listFiles({ q, subject, semester, type, mine, limit: PAGE_SIZE, cursor });
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
      <div className="page-head">
        <h1>{mine ? "My uploads" : "Library"}</h1>
        <p className="muted">{mine ? "Everything you have shared." : "Everything your campus has shared, newest first."}</p>
      </div>

      <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="field grow">
          <span>Search</span>
          <input type="search" value={filters.q} onChange={set("q")} maxLength={60} placeholder="Title, tag, file name or uploader" />
        </label>
        <label className="field">
          <span>Subject code</span>
          <input type="text" className="mono" value={filters.subject} onChange={set("subject")} maxLength={7} placeholder="UCS531" aria-describedby="subject-hint" />
        </label>
        <label className="field">
          <span>Semester</span>
          <select value={filters.semester} onChange={set("semester")}>
            <option value="">Any</option>
            {SEMESTERS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={filters.type} onChange={set("type")}>
            <option value="">Any</option>
            {limits.resourceTypes.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
        </label>
        {/* Always rendered: a button that appears on the first keystroke would shove the fields sideways. */}
        <button type="button" className="button quiet" disabled={!hasFilters} onClick={() => setFilters(EMPTY)}>Clear</button>
      </form>
      <p id="subject-hint" className="hint" aria-live="polite">
        {!subjectReady && "Type the full subject code, like UCS531."}
      </p>

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
        <ul className="cards">
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
    </>
  );
}
