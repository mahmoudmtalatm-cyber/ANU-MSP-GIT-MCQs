// ─────────────────────────────────────────────────────────────────────────
// Firebase configuration template
//
//   1. Create a free project at https://console.firebase.google.com
//   2. Enable "Google" as a Sign-in provider under Authentication.
//   3. Create a Firestore database (production mode) and add the security
//      rules from /firestore.rules in this repo.
//   4. In Project settings → General → Your apps, add a Web app and copy
//      the config object it gives you into the object below.
//   5. Copy this file to `firebase-config.js` (same folder) and fill it in:
//
//        cp js/config/firebase-config.example.js js/config/firebase-config.js
//
//   `firebase-config.js` is git-ignored so your own keys never get
//   committed. See README.md for the full setup walkthrough.
// ─────────────────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID" // optional
};
