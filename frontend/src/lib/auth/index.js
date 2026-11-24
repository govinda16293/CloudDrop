import { createLocalAuth } from "./local.js";

/** Pick the sign-in method named in config.json. */
export async function createAuth(config) {
  if (config.authMode === "local") return createLocalAuth(config);
  if (config.authMode === "supabase") {
    const { createSupabaseAuth } = await import("./supabase.js");
    return createSupabaseAuth(config);
  }
  // Loaded only when needed, so local mode does not download the Cognito library.
  const [{ createCognitoAuth }, library] = await Promise.all([
    import("./cognito.js"),
    import("amazon-cognito-identity-js"),
  ]);
  return createCognitoAuth(config, library);
}
