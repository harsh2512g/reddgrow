export type ExtensionBuildProfile = { apiOrigin: string; extensionId: string; manifestKey: string };
export function chromeIdForPublicKey(manifestKey: unknown): string;
export function validateExtensionProfile(
  input: unknown,
  deployment?: boolean,
): ExtensionBuildProfile;
export function readPublicExtensionProfile(
  repositoryRoot: string,
  profilePath: string,
  deployment?: boolean,
): Promise<ExtensionBuildProfile>;
