// =====================================
// MetaEscrow Firebase Configuration
// =====================================

// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    getFirestore,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";


// =====================================
// Firebase Configuration
// Replace the values below with your own
// =====================================

const firebaseConfig = {
  apiKey: "AIzaSyDnnAJXnXxHcSBfD46jmr0KGSR_KstOw9s",
  authDomain: "metaescrow-c10f3.firebaseapp.com",
  projectId: "metaescrow-c10f3",
  storageBucket: "metaescrow-c10f3.firebasestorage.app",
  messagingSenderId: "942736759161",
  appId: "1:942736759161:web:952a4df03d2958fdb5b7a8"
};


// =====================================
// Initialize Firebase
// =====================================

const app = initializeApp(firebaseConfig);


// =====================================
// Initialize Authentication
// =====================================

const auth = getAuth(app);


// =====================================
// Initialize Firestore
// =====================================

const db = getFirestore(app);


// =====================================
// Export Firebase Services
// =====================================

export {

    app,

    auth,

    db,

    serverTimestamp

};

import {
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

const auth = getAuth();

// Google
const googleProvider = new GoogleAuthProvider();

document.getElementById("googleSignIn").addEventListener("click", async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);

        const user = result.user;

        console.log("Signed in:", user);

        // Redirect
        window.location.href = "/dashboard.html";

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
});

// Microsoft
const microsoftProvider = new OAuthProvider("microsoft.com");

document.getElementById("microsoftSignIn").addEventListener("click", async () => {
    try {
        const result = await signInWithPopup(auth, microsoftProvider);

        const user = result.user;

        console.log("Signed in:", user);

        window.location.href = "/dashboard.html";

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
});
