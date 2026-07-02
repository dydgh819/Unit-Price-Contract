// Firebase initialization (ES module). Loaded once and shared by app.js.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBLHxup3P3yNnGdEab97YqRt-tAWfuWAS8",
  authDomain: "unit-price-contract.firebaseapp.com",
  projectId: "unit-price-contract",
  storageBucket: "unit-price-contract.firebasestorage.app",
  messagingSenderId: "1063646537549",
  appId: "1:1063646537549:web:91549f19630341ca58b904"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
