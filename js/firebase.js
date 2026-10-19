
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBx3VeBhSv8YeLNz9dus8fy6eKciLJFeqc",
  authDomain: "cruz-heist-graphics-lab.firebaseapp.com",
  projectId: "cruz-heist-graphics-lab",
  storageBucket: "cruz-heist-graphics-lab.firebasestorage.app",
  messagingSenderId: "243408480962",
  appId: "1:243408480962:web:281352052f28253033e95b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
