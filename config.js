// Configuration. No secrets here. (The Firebase web config is public by design;
// restrict the key to your domain in Google Cloud Console > APIs & Services > Credentials.)
const firebaseConfig = {
  apiKey: "AIzaSyDUefeJbHKIAs-l3zvFlGaas6VD63vv4kI",
  authDomain: "inspire4ever-c60ad.firebaseapp.com",
  databaseURL: "https://inspire4ever-c60ad-default-rtdb.firebaseio.com",
  projectId: "inspire4ever-c60ad",
  storageBucket: "inspire4ever-c60ad.appspot.com",
  messagingSenderId: "125014633127",
  appId: "1:125014633127:web:d29e4c37628ab637f40982"
};

const API_URL = "https://trenndly.ds957117122.workers.dev";

const MAX_MB = 300;                       // must match MAX_MB in wrangler.toml (the Worker enforces it)
const MAX_SIZE = MAX_MB * 1024 * 1024;

// UI only (shows the admin link). The real admin check is in the database rules and in the Worker.
const ADMIN_EMAILS = ["ds957117122@gmail.com"];