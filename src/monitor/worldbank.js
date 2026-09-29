/**
 * World Bank indicator helper (free, no key).
 *
 * The API answers `[meta, rows]` where rows may contain nulls for years a
 * country did not report. `mrv=1` asks for the most recent non-empty value per
 * country, which is what we want for an annual macro panel.
 */

import { fetchJSON } from "./net.js";

const BASE = "https://api.worldbank.org/v2";

/** Country codes: WLD = world, EUU = European Union, plus ISO2/ISO3 codes. */
export async function fetchIndicator(code, countries) {
  const url = BASE + "/country/" + countries.join(";") + "/indicator/" + code +
    "?format=json&mrv=1&per_page=80";
  const data = await fetchJSON("worldbank", url, { timeout: 25000 });
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return data[1]
    .filter(r => r && r.value != null && typeof r.value === "number")
    .map(r => ({
      country: (r.country && r.country.value) || r.countryiso3code || "—",
      year: r.date,
      value: r.value,
      name: (r.indicator && r.indicator.value) || code
    }));
}

export const INDICATORS = {
  gdpGrowth: "NY.GDP.MKTP.KD.ZG",
  inflation: "FP.CPI.TOTL.ZG",
  renewableElectricity: "EG.ELC.RNEW.ZS",
  energyImports: "EG.IMP.CONS.ZS",
  fossilFuelShare: "EG.USE.COMM.FO.ZS"
};
