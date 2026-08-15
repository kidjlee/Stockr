import type { Instrument, ProviderReading } from "../lib/types";

export interface ProviderContext {
  /** Log a line namespaced to the provider. */
  log: (message: string) => void;
  /** How many in-flight requests this provider may make. */
  concurrency: number;
}

export interface Provider {
  id: string;
  label: string;
  /**
   * Trust weight in the blend. Sources that publish a full rating
   * distribution plus an analyst count score higher than ones that only
   * publish a single word.
   */
  weight: number;
  /** Where the data comes from, shown on the methodology page. */
  homepage: string;
  /** One-line description for the methodology page. */
  description: string;
  /**
   * Why this provider is off by default, if it is. Presence of this field
   * means the provider is opt-in.
   */
  optIn?: string;
  /** Env var that turns an opt-in provider on, or supplies its API key. */
  envVar?: string;
  /** Whether the provider can run in the current environment. */
  isEnabled(): boolean;
  /** Fetch readings for the whole batch. Must not throw for individual misses. */
  fetch(
    instruments: Instrument[],
    ctx: ProviderContext,
  ): Promise<ProviderReading[]>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Truthy env flags: "1", "true", "yes", "on". */
export function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function envKey(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}
