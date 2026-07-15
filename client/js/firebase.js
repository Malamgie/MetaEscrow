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
