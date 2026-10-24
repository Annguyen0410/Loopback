/**
 * Country names used by the Monitor's curated profiles, plus the common short
 * forms that appear in feeds. This is deliberately small and static: it is a
 * normalizer, not a gazetteer, and it gives the event layer a stable ISO code
 * instead of guessing from a headline.
 */

export const COUNTRIES = [
  ["US", "United States", ["USA", "U.S.", "United States of America"]],
  ["CN", "China", ["PRC", "People's Republic of China"]],
  ["RU", "Russia", ["Russian Federation"]],
  ["IN", "India", []],
  ["BR", "Brazil", []],
  ["GB", "United Kingdom", ["UK", "U.K.", "Great Britain", "Britain"]],
  ["DE", "Germany", []],
  ["FR", "France", []],
  ["JP", "Japan", []],
  ["KR", "South Korea", ["Republic of Korea", "Korea, South"]],
  ["IR", "Iran", ["Islamic Republic of Iran"]],
  ["KP", "North Korea", ["DPRK", "Korea, North"]],
  ["SA", "Saudi Arabia", []],
  ["TR", "Turkey", ["Türkiye", "Turkiye"]],
  ["NG", "Nigeria", []],
  ["ZA", "South Africa", []],
  ["EG", "Egypt", []],
  ["MX", "Mexico", []],
  ["ID", "Indonesia", []],
  ["AU", "Australia", []],
  ["CA", "Canada", []],
  ["AR", "Argentina", []],
  ["PK", "Pakistan", []],
  ["BD", "Bangladesh", []],
  ["VN", "Vietnam", ["Viet Nam"]],
  ["TH", "Thailand", []],
  ["MY", "Malaysia", []],
  ["SG", "Singapore", []],
  ["AE", "United Arab Emirates", ["UAE"]],
  ["IL", "Israel", []],
  ["UA", "Ukraine", []],
  ["PL", "Poland", []],
  ["IT", "Italy", []],
  ["ES", "Spain", []],
  ["VE", "Venezuela", []],
  ["SY", "Syria", []],
  ["AF", "Afghanistan", []],
  ["MM", "Myanmar", ["Burma"]],
  ["ET", "Ethiopia", []],
  ["CO", "Colombia", []],
  ["PH", "Philippines", []],
  ["KE", "Kenya", []],
  ["TW", "Taiwan", ["Taiwan, China"]],
  ["YE", "Yemen", []],
  ["CU", "Cuba", []],
  ["IQ", "Iraq", []],
  ["LB", "Lebanon", []],
  ["QA", "Qatar", []]
];

const BY_NAME = new Map();
const BY_CODE = new Map();
for (const [code, name, aliases] of COUNTRIES) {
  BY_CODE.set(code, name);
  for (const value of [code, name, ...aliases]) {
    BY_NAME.set(String(value).toLowerCase().replace(/[.]/g, "").trim(), code);
  }
}

function clean(value) {
  return String(value == null ? "" : value).replace(/[.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** ISO code for a country name/alias/code, or "" when it is not in the map. */
export function countryCode(value) {
  const raw = String(value == null ? "" : value).trim();
  if (/^[a-z]{2}$/i.test(raw)) {
    const code = raw.toUpperCase();
    return BY_CODE.has(code) ? code : code;
  }
  return BY_NAME.get(clean(raw)) || "";
}

export function countryName(value) {
  const code = countryCode(value);
  return BY_CODE.get(code) || String(value == null ? "" : value).trim();
}

export function countryNameForCode(code) {
  return BY_CODE.get(String(code || "").toUpperCase()) || "";
}

export function countryLabel(value) {
  const code = countryCode(value);
  const name = BY_CODE.get(code);
  return name || String(value == null ? "" : value).trim();
}
