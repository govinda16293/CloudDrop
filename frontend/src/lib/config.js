/**
 * Runtime settings come from /config.json, not from the build. The same build
 * runs in local mode and on AWS; the deploy script writes the AWS version of
 * the file from the stack's outputs.
 */
export function parseConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("config.json is missing or not an object.");
  const config = { authMode: raw.authMode, apiBase: raw.apiBase || "/api", emailDomain: raw.emailDomain || "thapar.edu" };
  if (config.authMode === "local") return config;
  if (config.authMode === "cognito") {
    if (!raw.userPoolId || !raw.userPoolClientId) {
      throw new Error("config.json needs userPoolId and userPoolClientId when authMode is cognito.");
    }
    return { ...config, userPoolId: raw.userPoolId, userPoolClientId: raw.userPoolClientId };
  }
  if (config.authMode === "supabase") {
    if (!raw.supabaseUrl || !raw.supabasePublishableKey) {
      throw new Error("config.json needs supabaseUrl and supabasePublishableKey when authMode is supabase.");
    }
    return { ...config, supabaseUrl: raw.supabaseUrl, supabasePublishableKey: raw.supabasePublishableKey, analyzerUrl: raw.analyzerUrl || "" };
  }
  throw new Error('config.json: authMode must be "local", "cognito", or "supabase".');
}

export async function loadConfig(fetchImpl = (...args) => fetch(...args)) {
  // Vercel supplies these at build time. Keeping config.json as the fallback
  // preserves the AWS/local demonstration path in this same repository.
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return parseConfig({
      authMode: "supabase",
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      emailDomain: "thapar.edu",
      analyzerUrl: import.meta.env.VITE_ANALYZER_URL || "",
    });
  }
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load config.json (${response.status}).`);
  return parseConfig(await response.json());
}
