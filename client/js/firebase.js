// =====================================
// MetaEscrow Firebase Configuration
// =====================================

// Import Firebase SDKs



import {
    ...
    writeBatch
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
    auth,
    db,
    serverTimestamp,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup,
    browserLocalPersistence,
    browserSessionPersistence,
    setPersistence,
    onAuthStateChanged,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    addDoc,
    runTransaction,
    writeBatch,
    deleteUser
};
