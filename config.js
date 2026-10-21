// Configuration. Keep real secrets server-side where possible.
const firebaseConfig = {
  apiKey: "AIzaSyDUefeJbHKIAs-l3zvFlGaas6VD63vv4kI",
  authDomain: "inspire4ever-c60ad.firebaseapp.com",
  databaseURL: "https://inspire4ever-c60ad-default-rtdb.firebaseio.com",
  projectId: "inspire4ever-c60ad",
  storageBucket: "inspire4ever-c60ad.appspot.com",
  messagingSenderId: "125014633127",
  appId: "1:125014633127:web:d29e4c37628ab637f40982"
};

const GEMINI_API_KEY = "AQ.Ab8RN6IWhJsMKKsn4wxw6kmkD5XCATwZnCG_2e5PI3HdSbCBeQ";
const GEMINI_MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-flash"];
const GEMINI = "https://generativelanguage.googleapis.com";

// YouTube search suggestions (free, bina API key ke)
const YT_LANG = "en";    // suggestions ki language (hi = Hindi)
const YT_REGION = "IN";  // kis desh ke log kya search karte hain (IN = India)

const MAX_MB = 300;               // <-- yahan sirf ye number badlo (Gemini Files API 2 GB tak leta hai)
const MAX_SIZE = MAX_MB * 1024 * 1024;

// Admin access: only these Gmail accounts can open admin.html (also enforce in Firebase rules)
const ADMIN_EMAILS = ["ds957117122@gmail.com"];

const HISTORY_MS = 7 * 24 * 60 * 60 * 1000; // history is kept for 7 days