import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("accepts a local-mode config", () => {
    expect(parseConfig({ authMode: "local" })).toEqual({ authMode: "local", apiBase: "/api", emailDomain: "thapar.edu" });
  });
  it("accepts a Cognito config", () => {
    const config = parseConfig({
      authMode: "cognito", apiBase: "/api", userPoolId: "ap-south-1_AbC", userPoolClientId: "client1", emailDomain: "example.ac.in",
    });
    expect(config).toMatchObject({ authMode: "cognito", userPoolId: "ap-south-1_AbC", userPoolClientId: "client1", emailDomain: "example.ac.in" });
  });
  it("refuses a Cognito config with ids missing", () => {
    expect(() => parseConfig({ authMode: "cognito" })).toThrow(/userPoolId/);
  });
  it("refuses an unknown mode", () => {
    expect(() => parseConfig({ authMode: "magic" })).toThrow(/authMode/);
    expect(() => parseConfig(null)).toThrow();
  });
});
