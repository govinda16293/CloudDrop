import { formatBytes } from "./format.js";

/** A quick check before any network call. The server checks again. */
export function checkFile(file, limits) {
  if (!file) return "Choose a file to upload.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > limits.maxFileBytes) {
    return `This file is too large. The limit is ${formatBytes(limits.maxFileBytes)}.`;
  }
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!limits.allowedExtensions.includes(extension)) {
    return `This file type is not allowed. Allowed: ${limits.allowedExtensions.join(", ")}`;
  }
  return null;
}

export function titleFromFileName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** S3 ignores every form field that comes after the file, so the file goes last. */
export function buildFormData(fields, file) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", file);
  return form;
}

/** Send the file straight to storage with the pre-signed form. XHR, because fetch has no upload progress. */
export function uploadToStorage(form, file, { onProgress, Xhr = XMLHttpRequest } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new Xhr();
    xhr.open("POST", form.url);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage refused the file (${xhr.status}). Try again.`));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(buildFormData(form.fields, file));
  });
}
