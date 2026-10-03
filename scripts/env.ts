/** Load .env.local for CLI scripts (Next.js does this itself for the app). */
try {
  process.loadEnvFile(".env.local");
} catch {
  // No file: rely on the real environment (CI, Vercel).
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
