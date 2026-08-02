// Structured address helpers — Indian states/UTs + common city suggestions.

/** Phase 67 — Title Case: "NEW DELHI" / "mumbai" → "New Delhi" / "Mumbai". */
export function titleCase(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s\-'/().])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
] as const;

export const DEFAULT_NATION = "India";

/** Official GST state codes, keyed by normalised state/UT name.
 *  Mirrors public.gst_state_code_from_name() in the database. */
const STATE_CODE_BY_NAME: Record<string, string> = {
  jammuandkashmir: "01", himachalpradesh: "02", punjab: "03", chandigarh: "04",
  uttarakhand: "05", uttaranchal: "05", haryana: "06", delhi: "07", newdelhi: "07",
  rajasthan: "08", uttarpradesh: "09", bihar: "10", sikkim: "11",
  arunachalpradesh: "12", nagaland: "13", manipur: "14", mizoram: "15",
  tripura: "16", meghalaya: "17", assam: "18", westbengal: "19", jharkhand: "20",
  odisha: "21", orissa: "21", chhattisgarh: "22", chattisgarh: "22",
  madhyapradesh: "23", gujarat: "24",
  dadraandnagarhavelianddamananddiu: "26", damananddiu: "26", dadraandnagarhaveli: "26",
  maharashtra: "27", maharastra: "27", karnataka: "29", goa: "30", lakshadweep: "31",
  kerala: "32", tamilnadu: "33", puducherry: "34", pondicherry: "34",
  andamanandnicobarislands: "35", andamanandnicobar: "35",
  telangana: "36", andhrapradesh: "37", ladakh: "38",
};

const normStateKey = (s: string | null | undefined) =>
  String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** "Maharashtra" / "maharastra" → "27". Null when unrecognised. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  return STATE_CODE_BY_NAME[normStateKey(name)] ?? null;
}

/** "27" → "Maharashtra". Null when unrecognised. */
export function stateNameFromCode(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim().padStart(2, "0");
  const hit = INDIAN_STATES.find((s) => STATE_CODE_BY_NAME[normStateKey(s)] === c);
  return hit ?? null;
}

export const NATIONS = [
  "India", "Nepal", "Bhutan", "Bangladesh", "Sri Lanka", "United States",
  "United Kingdom", "United Arab Emirates", "Australia", "Canada", "Germany",
  "France", "Singapore", "Other",
];

/** Suggestion list only — City stays free-entry so any town can be captured. */
export const INDIAN_CITIES = [
  "Agra", "Ahmedabad", "Ajmer", "Amritsar", "Aurangabad", "Bengaluru", "Bhopal",
  "Bhubaneswar", "Chandigarh", "Chennai", "Coimbatore", "Dehradun", "Delhi",
  "Faridabad", "Ghaziabad", "Goa", "Gurugram", "Guwahati", "Gwalior", "Hyderabad",
  "Indore", "Jaipur", "Jalandhar", "Jammu", "Jamshedpur", "Jodhpur", "Kanpur",
  "Kochi", "Kolhapur", "Kolkata", "Kota", "Lucknow", "Ludhiana", "Madurai",
  "Mangaluru", "Mumbai", "Mysuru", "Nagpur", "Nashik", "Navi Mumbai", "Noida",
  "Patna", "Pune", "Raipur", "Rajkot", "Ranchi", "Shimla", "Siliguri", "Solapur",
  "Srinagar", "Surat", "Thane", "Thiruvananthapuram", "Tiruchirappalli", "Udaipur",
  "Vadodara", "Varanasi", "Vijayawada", "Visakhapatnam",
];
