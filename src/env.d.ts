/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    authenticated: boolean;
  }
}

interface ImportMetaEnv {
  readonly FARO_PASSWORD?: string;
  readonly FARO_SESSION_SECRET?: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
}
