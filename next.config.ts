import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['adm-zip', 'exceljs', 'pg', 'archiver', '@electric-sql/pglite'],
  poweredByHeader: false,
  outputFileTracingExcludes: { '*': ['./data/**/*', './tmp/**/*', './backups/**/*', './test-results/**/*'] },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" }
    ] }];
  }
};
export default config;
