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

    apiKey: "YOUR_API_KEY",

    authDomain: "YOUR_PROJECT.firebaseapp.com",

    projectId: "YOUR_PROJECT_ID",

    storageBucket: "YOUR_PROJECT.appspot.com",

    messagingSenderId: "YOUR_SENDER_ID",

    appId: "YOUR_APP_ID"

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
