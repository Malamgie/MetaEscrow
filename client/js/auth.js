import {
    auth,
    db,

    googleProvider,
    microsoftProvider,

    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    signInWithPopup,
    signOut,

    doc,
    getDoc,
    setDoc,
    updateDoc,

    collection,
    addDoc,

    serverTimestamp,

    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence

} from "./firebase.js";

import {

    COLLECTIONS,
    ACCOUNT_STATUS,
    ROLES,
    ROUTES

} from "./constants.js";

import {

    getDeviceInfo,
    redirectByRole

} from "./auth-utils.js";

function generatePublicUserId() {

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id = "ME-";

    for (let i = 0; i < 6; i++) {

        id += chars[Math.floor(Math.random() * chars.length)];

    }

    return id;

}
function generateReferralCode() {

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

        code += chars[Math.floor(Math.random() * chars.length)];

    }

    return code;

}

export function normalizeUsername(username) {

    return username
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9_]/g, "");

}

export async function usernameExists(username) {

    const ref = doc(db, "usernames", normalizeUsername(username));

    const snap = await getDoc(ref);

    return snap.exists();

}

async function reserveUsername(uid, username) {

    await setDoc(

        doc(db, "usernames", normalizeUsername(username)),

        {

            uid,

            createdAt: serverTimestamp()

        }

    );

}

async function reserveReferralCode(uid, code) {

    await setDoc(

        doc(db, "referralCodes", code),

        {

            uid,

            createdAt: serverTimestamp()

        }

    );

}

async function createWallet(uid) {

    await setDoc(

        doc(db, "wallets", uid),

        {

            availableBalance: 0,

            escrowBalance: 0,

            pendingBalance: 0,

            currency: "NGN",

            totalDeposits: 0,

            totalWithdrawals: 0,

            totalEscrow: 0,

            updatedAt: serverTimestamp()

        }

    );

}

async function createSettings(uid) {

    await setDoc(

        doc(db, "settings", uid),

        {

            darkMode: false,

            language: "en",

            emailNotification: true,

            smsNotification: true,

            pushNotification: true,

            updatedAt: serverTimestamp()

        }

    );

}

async function createSecurity(uid) {

    await setDoc(

        doc(db, "security", uid),

        {

            failedAttempts: 0,

            accountLocked: false,

            twoFactorEnabled: false,

            lastPasswordChange: null,

            updatedAt: serverTimestamp()

        }

    );

}

async function createWelcomeNotification(uid) {

    await addDoc(

        collection(db, "notifications", uid, "messages"),

        {

            title: "Welcome to MetaEscrow",

            message:
                "Your account has been created successfully.",

            read: false,

            createdAt: serverTimestamp()

        }

    );

}

async function createUserProfile(user, data) {

    const publicUserId = generatePublicUserId();
    const referralCode = generateReferralCode();

    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), {

        uid: user.uid,

        publicUserId,

        email: user.email,

        fullName: data.fullName,

        username: normalizeUsername(data.username),

        phone: data.phone,

        photoURL: user.photoURL || "",

        role: ROLES.BUYER,

        accountStatus: ACCOUNT_STATUS.ACTIVE,

        emailVerified: user.emailVerified,

        phoneVerified: false,

        kycLevel: 0,

        referralCode,

        referredBy: data.referredBy || null,

        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp(),

        lastLogin: null

    });

    await reserveUsername(user.uid, data.username);

    await reserveReferralCode(user.uid, referralCode);

    await createWallet(user.uid);

    await createSettings(user.uid);

    await createSecurity(user.uid);

    await createWelcomeNotification(user.uid);

}

async function createSocialProfile(user) {

    const publicUserId = await generateUniquePublicUserId();
    const referralCode = await generateUniqueReferralCode();

    const username =
        normalizeUsername(
            user.displayName || user.email.split("@")[0]
        );

    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), {

        uid: user.uid,

        publicUserId,

        email: user.email,

        fullName: user.displayName || "",

        username,

        phone: user.phoneNumber || "",

        photoURL: user.photoURL || "",

        role: ROLES.BUYER,

        accountStatus: ACCOUNT_STATUS.ACTIVE,

        emailVerified: true,

        phoneVerified: false,

        kycLevel: 0,

        referralCode,

        referredBy: null,

        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp(),

        lastLogin: null

    });

    await reserveUsername(user.uid, username);

    await reserveReferralCode(user.uid, referralCode);

    await createWallet(user.uid);

    await createSettings(user.uid);

    await createSecurity(user.uid);

    await createWelcomeNotification(user.uid);

}

async function processAuthenticatedUser(user) {

    let profile = await getUserProfile(user.uid);

    if (!profile) {

        await createSocialProfile(user);

        profile = await getUserProfile(user.uid);

    }

    if (profile.accountStatus !== ACCOUNT_STATUS.ACTIVE) {

        await signOut(auth);

        throw new Error("Your account is inactive.");

    }

    return await processAuthenticatedUser(
    credential.user
);

}
export {

    googleLogin,

    microsoftLogin

};

export async function googleLogin() {

    const result = await signInWithPopup(

        auth,

        googleProvider

    );

    return await processAuthenticatedUser(

        result.user

    );

}





export async function registerUser(data) {

    if (await usernameExists(data.username)) {

        throw new Error("Username already exists.");

    }

    const credential = await createUserWithEmailAndPassword(

        auth,

        data.email,

        data.password

    );

    await sendEmailVerification(credential.user);

    await createUserProfile(

        credential.user,

        data

    );

    return credential.user;

}

export async function getUserProfile(uid) {

    const snap = await getDoc(

        doc(db, COLLECTIONS.USERS, uid)

    );

    if (!snap.exists()) {

        return null;

    }

    return snap.data();

}

async function updateLastLogin(uid) {

    const device = getDeviceInfo();

    await updateDoc(

        doc(db, COLLECTIONS.USERS, uid),

        {

            lastLogin: serverTimestamp(),

            updatedAt: serverTimestamp(),

            lastDevice: device.device,

            lastBrowser: device.browser,

            lastPlatform: device.platform

        }

    );

}

async function recordLoginHistory(uid, status) {

    const device = getDeviceInfo();

    await addDoc(

        collection(db, COLLECTIONS.LOGIN_HISTORY),

        {

            uid,

            status,

            browser: device.browser,

            platform: device.platform,

            device: device.device,

            language: device.language,

            timestamp: serverTimestamp()

        }

    );

}

export async function loginUser(email, password, rememberMe = true) {

    await setPersistence(

        auth,

        rememberMe

            ? browserLocalPersistence

            : browserSessionPersistence

    );

    const credential = await signInWithEmailAndPassword(

        auth,

        email,

        password

    );

    const profile = await getUserProfile(

        credential.user.uid

    );

    if (!profile) {

        throw new Error("Profile not found.");

    }

    if (profile.accountStatus !== ACCOUNT_STATUS.ACTIVE) {

        await signOut(auth);

        throw new Error("Your account is inactive.");

    }

    await updateLastLogin(

        credential.user.uid

    );

    await recordLoginHistory(

        credential.user.uid,

        "success"

    );

    return {

        user: credential.user,

        profile

    };

}

export async function logoutUser() {

    await signOut(auth);

}

export async function resetPassword(email) {

    await sendPasswordResetEmail(

        auth,

        email

    );

}

export async function getCurrentUser() {

    return auth.currentUser;

}

export function redirectUser(profile) {

    redirectByRole(

        profile.role

    );

}

