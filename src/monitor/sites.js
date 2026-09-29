/**
 * Static reference layers — AI data centers, nuclear stations, military bases
 * and spaceports. These are curated public locations (a gazetteer): they do
 * not claim to be live telemetry, and every point is a real facility site.
 *
 * The GPS-jamming layer that used to live here has been removed: no free API
 * publishes live jamming zones, so those circles were an editorial guess drawn
 * on top of real conflict regions.
 */

import { getMapLayer } from "./map-layers.js";
import { layerState } from "./layer-toggles.js";
import { esc } from "./utils.js";

const DATACENTERS = [
  ["Ashburn, VA", 39.04, -77.49], ["Santa Clara, CA", 37.35, -121.95],
  ["Dallas, TX", 32.78, -96.80], ["Phoenix, AZ", 33.45, -112.07],
  ["Chicago, IL", 41.88, -87.63], ["Columbus, OH", 39.96, -83.00],
  ["Montreal, QC", 45.50, -73.57], ["London, UK", 51.51, -0.13],
  ["Dublin, IE", 53.35, -6.26], ["Amsterdam, NL", 52.37, 4.90],
  ["Frankfurt, DE", 50.11, 8.68], ["Paris, FR", 48.86, 2.35],
  ["Beijing, CN", 39.90, 116.40], ["Shanghai, CN", 31.23, 121.47],
  ["Shenzhen, CN", 22.54, 114.06], ["Singapore", 1.35, 103.82],
  ["Tokyo, JP", 35.68, 139.69], ["Osaka, JP", 34.69, 135.50],
  ["Seoul, KR", 37.57, 126.98], ["Sydney, AU", -33.87, 151.21],
  ["São Paulo, BR", -23.55, -46.63], ["Mumbai, IN", 19.08, 72.88],
  ["Hyderabad, IN", 17.39, 78.49], ["Riyadh, SA", 24.71, 46.68]
];

const NUCLEAR = [
  ["Fukushima Daiichi", 37.42, 141.03], ["Kashiwazaki-Kariwa", 37.43, 138.60],
  ["Zaporizhzhia NPP", 47.51, 34.58], ["Chernobyl", 51.39, 30.10],
  ["Rivne NPP", 51.33, 25.90], ["Khmelnytskyi NPP", 50.30, 26.65],
  ["South Ukraine NPP", 47.81, 31.22], ["Leningrad NPP", 59.85, 29.04],
  ["Kursk NPP", 51.67, 35.60], ["Balakovo NPP", 52.09, 47.75],
  ["Cattenom NPP", 49.42, 6.22], ["Gravelines NPP", 51.01, 2.14],
  ["Flamanville NPP", 49.54, -1.88], ["Palo Verde", 33.39, -112.86],
  ["Vogtle", 33.14, -81.76], ["Diablo Canyon", 35.21, -120.86],
  ["Bruce", 44.32, -81.60], ["Darlington", 43.87, -78.72],
  ["Koeberg", -33.68, 18.43], ["Taishan NPP", 21.92, 112.82],
  ["Yangjiang NPP", 21.71, 112.26], ["Kudankulam NPP", 8.17, 77.71]
];

const BASES = [
  ["Fort Bragg", 35.13, -78.99], ["Naval Station Norfolk", 36.93, -76.29],
  ["Naval Base San Diego", 32.68, -117.24], ["Pearl Harbor", 21.35, -157.97],
  ["Ramstein AB", 49.44, 7.60], ["Diego Garcia", -7.31, 72.41],
  ["Naval Base Guam", 13.44, 144.79], ["Yokosuka", 35.29, 139.67],
  ["Okinawa", 26.50, 127.87], ["Camp Arifjan (KW)", 29.35, 47.62],
  ["Al Udeid AB (QA)", 25.12, 51.31], ["Naval Support Bahrain", 26.21, 50.61],
  ["Severomorsk", 69.07, 33.42], ["Kaliningrad", 54.70, 20.51],
  ["Sevastopol", 44.61, 33.53], ["Tartus", 34.89, 35.87],
  ["Qingdao", 36.07, 120.31], ["Sanya (Hainan)", 18.24, 109.51],
  ["Lhasa", 29.65, 91.13], ["HMNB Portsmouth", 50.80, -1.09],
  ["HMNB Clyde (Faslane)", 56.05, -4.82], ["Toulon", 43.12, 5.93],
  ["Visakhapatnam", 17.73, 83.34], ["Sohae", 39.66, 124.71],
  ["Bandar Abbas", 27.18, 56.27]
];

const SPACEPORTS = [
  ["Cape Canaveral", 28.47, -80.57], ["Vandenberg", 34.74, -120.57],
  ["Baikonur", 45.96, 63.31], ["Plesetsk", 62.93, 40.58],
  ["Vostochny", 51.88, 128.33], ["Kourou", 5.24, -52.77],
  ["Tanegashima", 30.40, 130.97], ["Jiuquan", 40.96, 100.29],
  ["Xichang", 28.24, 102.03], ["Wenchang", 19.63, 110.95],
  ["Taiyuan", 38.85, 111.61], ["Satish Dhawan", 13.72, 80.23],
  ["Starbase (Boca Chica)", 25.99, -97.19], ["Mahia", -39.26, 177.86],
  ["Andøya", 69.29, 16.02], ["Esrange", 67.89, 21.10]
];

function renderPoints(name, data, color, icon) {
  const g = getMapLayer(name);
  if (!g) return;
  g.clearLayers();
  if (!layerState[name]) return;
  for (const [label, lat, lng] of data) {
    const m = L.circleMarker([lat, lng], { radius: 4, fillColor: color, color: "#000", weight: 0.8, opacity: 0.9, fillOpacity: 0.8 });
    m.bindPopup('<div class="popup-place">' + icon + " " + esc(label) + "</div>" +
      '<div class="popup-row"><span class="popup-label">Type</span><span class="popup-value">reference site</span></div>');
    m.addTo(g);
  }
}

export function renderDatacenters() { renderPoints("datacenters", DATACENTERS, "#ff00cc", "🖥"); }
export function renderNuclear()     { renderPoints("nuclear", NUCLEAR, "#ffcc00", "☢"); }
export function renderBases()      { renderPoints("bases", BASES, "#ff5533", "⚑"); }
export function renderSpaceports() { renderPoints("spaceports", SPACEPORTS, "#bb88ff", "🚀"); }
