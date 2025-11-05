// frontend/src/features/analyzer-connection/utils/identityParser.ts

/**
 * Parse full analyzer identity string to "Manufacturer Model" format
 * Example: "Agilent Technologies,E4440A,..." → "Agilent Technologies E4440A"
 */
export function parseIdentity(full: string | undefined | null): string {
  if (!full) return "";
  
  const parts = full.split(",");
  if (parts.length >= 2) {
    return `${parts[0].trim()} ${parts[1].trim()}`;
  }
  
  return full.trim();
}