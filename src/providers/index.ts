import type { ProviderMeta } from "../lib/aggregate";
import { finnhubProvider } from "./finnhub";
import { fmpProvider } from "./fmp";
import { manualProvider } from "./manual";
import { tipranksProvider } from "./tipranks";
import { tradingViewProvider } from "./tradingview";
import type { Provider } from "./types";
import { yahooProvider } from "./yahoo";

/** Every provider Stockr knows about, in blend-weight order. */
export const ALL_PROVIDERS: Provider[] = [
  yahooProvider,
  tradingViewProvider,
  manualProvider,
  finnhubProvider,
  tipranksProvider,
  fmpProvider,
];

export function enabledProviders(only?: string[]): Provider[] {
  const filtered = only?.length
    ? ALL_PROVIDERS.filter((p) => only.includes(p.id))
    : ALL_PROVIDERS;
  return filtered.filter((p) => p.isEnabled());
}

export function providerMetaMap(providers: Provider[]): Map<string, ProviderMeta> {
  return new Map(
    providers.map((p) => [p.id, { id: p.id, label: p.label, weight: p.weight }]),
  );
}

export { yahooProvider, tradingViewProvider, finnhubProvider, fmpProvider, tipranksProvider, manualProvider };
export type { Provider };
