// Structured address helpers — Indian states/UTs + common city suggestions.

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
