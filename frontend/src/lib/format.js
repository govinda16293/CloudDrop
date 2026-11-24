export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

const UNITS = ["B", "KB", "MB", "GB", "TB"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBytes(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${UNITS[unit]}`;
}

export function formatDate(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 2 * 86400) return "yesterday";
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} days ago`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function parseTags(text) {
  const tags = [];
  for (const part of String(text || "").split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function typeLabel(resourceType) {
  const words = String(resourceType || "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Same shape the server enforces: 2-4 letters then 3 digits, e.g. UCS531. */
export function isSubjectCode(text) {
  return /^[A-Za-z]{2,4}[0-9]{3}$/.test(String(text || "").trim());
}
