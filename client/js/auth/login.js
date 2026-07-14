/**
 * @fileoverview Authentication Controller for MetaEscrow
 * @description Handles user login, session management, and role-based redirection.
 * @author Principal Architect
 * @version 1.0.0
 */
import { auth } from "./js/firebase.js";

import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";


import {
    auth,
    db,
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signOut,
    doc,
    getDoc,
    updateDoc,
    collection,
    addDoc,
    serverTimestamp
} from './js/firebase.js';

class LoginController {
    constructor() {
        // DOM Elements
        this.form = document.getElementById('loginForm');
        this.emailInput = document.getElementById('email');
        this.passwordInput = document.getElementById('password');
        this.rememberMeCheckbox = document.getElementById('rememberMe');
        this.btnSubmit = document.getElementById('btnSubmit');
        this.spinner = document.getElementById('loadingSpinner');
        this.errorContainer = document.getElementById('errorContainer');
        this.errorMessage = document.getElementById('errorMessage');

        // State Management
        this.isAuthenticating = false;
        this.MAX_FAILED_ATTEMPTS = 5;
        this.LOCKOUT_DURATION_MS = 30000; // 30 seconds

        this.init();
    }

    /**
     * Bootstraps the controller and restores saved preferences
     */
    init() {
        if (!this.form) return;

        // Restore remembered email for UX
        const savedEmail = localStorage.getItem('metaEscrow_rememberedEmail');
        if (savedEmail && this.emailInput) {
            this.emailInput.value = savedEmail;
            this.rememberMeCheckbox.checked = true;
        }

        this.form.addEventListener('submit', (e) => this.handleLogin(e));
    }

    /**
     * Main orchestration method for the login sequence
     * @param {Event} event 
     */
    async handleLogin(event) {
        event.preventDefault();

        if (this.isAuthenticating) return;
        
        // Prevent brute force at the UI level
        if (this.isClientLockedOut()) {
            this.uiManager.showError('Too many failed attempts. Please wait 30 seconds.');
            return;
        }

        this.uiManager.clearErrors();
        this.uiManager.setLoading(true);
        this.isAuthenticating = true;

        const formData = {
            email: this.emailInput.value.trim().toLowerCase(),
            password: this.passwordInput.value,
            rememberMe: this.rememberMeCheckbox.checked
        };

        // 1. Local Validation
        const validationError = this.validateInput(formData);
        if (validationError) {
            this.uiManager.showError(validationError.message);
            this.uiManager.focusField(validationError.field);
            this.finalizeLoginAttempt();
            return;
        }

        try {
            // 2. Set Session Persistence
            await this.setSessionPersistence(formData.rememberMe);

            // 3. Authenticate with Firebase
            const userCredential = await this.authenticateUser(formData.email, formData.password);
            const authUser = userCredential.user;

            // 4. Retrieve Firestore Profile
            const userProfile = await this.loadUserProfile(authUser.uid);

            if (!userProfile) {
                await this.logoutSuspendedUser();
                throw { custom: true, message: 'Account data not found. Please contact support.' };
            }

            // 5. Verify Operational Status
            const statusCheck = this.verifyAccountStatus(userProfile.accountStatus);
            if (!statusCheck.valid) {
                await this.logoutSuspendedUser();
                if (statusCheck.redirect) {
                    window.location.href = statusCheck.redirect;
                    return;
                }
                throw { custom: true, message: statusCheck.message };
            }

            // 6. Post-Login Maintenance
            this.resetFailedAttempts();
            this.manageRememberMe(formData.email, formData.rememberMe);

            // Fire-and-forget logging (don't block UI redirection)
            Promise.all([
                this.updateLastLogin(authUser.uid),
                this.recordLoginHistory(authUser.uid, userProfile.publicUserId, 'success')
            ]).catch(err => console.error('[MetaEscrow] Error saving login history:', err));

            // 7. Role-Based Routing
            this.redirectUser(userProfile.role);

        } catch (error) {
            this.handleFirebaseErrors(error, formData.email);
            this.finalizeLoginAttempt();
        }
    }

    /**
     * Validates input fields before sending requests
     * @param {Object} data 
     * @returns {Object|null} Error object or null if valid
     */
    validateInput(data) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!data.email) {
            return { field: 'email', message: 'Email address is required.' };
        }
        if (!emailRegex.test(data.email)) {
            return { field: 'email', message: 'Please enter a valid email address.' };
        }
        if (!data.password) {
            return { field: 'password', message: 'Password is required.' };
        }
        return null;
    }

    /**
     * Configures Firebase session persistence
     * @param {boolean} rememberMe 
     */
    async setSessionPersistence(rememberMe) {
        const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistenceType);
    }

    /**
     * Authenticates user via Firebase
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<Object>} Firebase UserCredential
     */
    async authenticateUser(email, password) {
        return await signInWithEmailAndPassword(auth, email, password);
    }

    /**
     * Fetches user profile from Firestore
     * @param {string} uid 
     * @returns {Promise<Object|null>}
     */
    async loadUserProfile(uid) {
        const userRef = doc(db, 'users', uid);
        const docSnap = await getDoc(userRef);
        return docSnap.exists() ? docSnap.data() : null;
    }

    /**
     * Checks if the account is permitted to log in
     * @param {string} status 
     * @returns {Object} { valid: boolean, message?: string, redirect?: string }
     */
    verifyAccountStatus(status) {
        switch (status) {
            case 'active':
                return { valid: true };
            case 'suspended':
                return { valid: false, message: 'Your account has been suspended due to policy violations.' };
            case 'banned':
                return { valid: false, message: 'Your account has been permanently banned. Contact support.' };
            case 'inactive':
                return { valid: false, message: 'Please activate your account.', redirect: '/activate.html' };
            default:
                return { valid: false, message: 'Unknown account status. Contact support.' };
        }
    }

    /**
     * Updates the user's last login metadata
     * @param {string} uid 
     */
    async updateLastLogin(uid) {
        const userRef = doc(db, 'users', uid);
        const deviceInfo = this.getDeviceFingerprint();

        await updateDoc(userRef, {
            lastLogin: serverTimestamp(),
            lastLoginDevice: deviceInfo.device,
            lastLoginBrowser: deviceInfo.browser,
            lastLoginOS: deviceInfo.os
        });
    }

    /**
     * Appends an audit log to the login history collection
     * @param {string} uid 
     * @param {string} publicUserId 
     * @param {string} status 'success' or 'failed'
     */
    async recordLoginHistory(uid, publicUserId, status) {
        const historyRef = collection(db, 'loginHistory');
        const deviceInfo = this.getDeviceFingerprint();

        await addDoc(historyRef, {
            uid: uid,
            publicUserId: publicUserId || 'UNKNOWN',
            timestamp: serverTimestamp(),
            device: deviceInfo.device,
            browser: deviceInfo.browser,
            platform: deviceInfo.os,
            status: status
        });
    }

    /**
     * Routes the user based on their Firestore role
     * @param {string} role 
     */
    redirectUser(role) {
        this.uiManager.showSuccess('Login successful! Redirecting...');
        
        setTimeout(() => {
            switch (role) {
                case 'admin':
                    window.location.href = '/client/admin.html';
                    break;
                case 'moderator':
                    window.location.href = '/moderator.html';
                    break;
                case 'support':
                    window.location.href = '/support-dashboard.html';
                    break;
                case 'user':
                default:
                    window.location.href = '/client/dashboard.html';
                    break;
            }
        }, 1000);
    }

    /**
     * Revokes Auth token immediately for suspended users
     */
    async logoutSuspendedUser() {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('[MetaEscrow] Failed to sign out suspended user.', error);
        }
    }

    /**
     * Centralized error handler to sanitize messages and track failures
     * @param {Error} error 
     * @param {string} email 
     */
    handleFirebaseErrors(error, email) {
        console.error('[MetaEscrow Auth Error]:', error.code || error);
        
        let friendlyMessage = 'An unexpected error occurred. Please try again later.';
        let focusField = null;

        if (error.custom) {
            friendlyMessage = error.message;
        } else {
            // Generalize invalid credentials to prevent email enumeration
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    friendlyMessage = 'Invalid email or password.';
                    focusField = 'email';
                    this.incrementFailedAttempts(email);
                    break;
                case 'auth/user-disabled':
                    friendlyMessage = 'This account has been disabled by an administrator.';
                    break;
                case 'auth/too-many-requests':
                    friendlyMessage = 'Too many failed login attempts. Please try again later or reset your password.';
                    break;
                case 'auth/network-request-failed':
                    friendlyMessage = 'Network error. Please check your connection and try again.';
                    break;
            }
        }

        this.uiManager.showError(friendlyMessage);
        if (focusField) this.uiManager.focusField(focusField);
    }

    /**
     * Handles local storage of email based on Remember Me checkbox
     * @param {string} email 
     * @param {boolean} rememberMe 
     */
    manageRememberMe(email, rememberMe) {
        if (rememberMe) {
            localStorage.setItem('metaEscrow_rememberedEmail', email);
        } else {
            localStorage.removeItem('metaEscrow_rememberedEmail');
        }
    }

    /**
     * Tracks failed attempts locally to throttle UI requests
     * (Note: Backend locking requires Firebase Cloud Functions)
     * @param {string} email 
     */
    incrementFailedAttempts(email) {
        const attemptsKey = `metaEscrow_failedAttempts_${email}`;
        let attempts = parseInt(localStorage.getItem(attemptsKey) || '0', 10);
        attempts++;
        
        localStorage.setItem(attemptsKey, attempts.toString());

        if (attempts >= this.MAX_FAILED_ATTEMPTS) {
            localStorage.setItem('metaEscrow_lockoutTime', Date.now().toString());
        }
    }

    /**
     * Checks if the client is currently locked out from brute-force protection
     * @returns {boolean}
     */
    isClientLockedOut() {
        const lockoutTime = parseInt(localStorage.getItem('metaEscrow_lockoutTime') || '0', 10);
        if (lockoutTime > 0) {
            const timePassed = Date.now() - lockoutTime;
            if (timePassed < this.LOCKOUT_DURATION_MS) {
                return true;
            } else {
                // Lockout expired
                localStorage.removeItem('metaEscrow_lockoutTime');
            }
        }
        return false;
    }

    /**
     * Resets local failure counters upon successful login
     */
    resetFailedAttempts() {
        if (this.emailInput) {
            localStorage.removeItem(`metaEscrow_failedAttempts_${this.emailInput.value.trim().toLowerCase()}`);
        }
        localStorage.removeItem('metaEscrow_lockoutTime');
    }

    /**
     * Extracts basic device telemetry
     * @returns {Object}
     */
    getDeviceFingerprint() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        let os = 'Unknown';

        // Basic Browser Detection
        if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';

        // Basic OS Detection
        if (ua.includes('Win')) os = 'Windows';
        else if (ua.includes('Mac')) os = 'MacOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iOS') || ua.includes('iPhone')) os = 'iOS';

        return {
            device: /Mobi|Android/i.test(ua) ? 'Mobile' : 'Desktop',
            browser: browser,
            os: os
        };
    }

    /**
     * Resets UI state after login sequence finishes
     */
    finalizeLoginAttempt() {
        this.isAuthenticating = false;
        this.uiManager.setLoading(false);
    }

    /**
     * UI Management Utility
     */
    get uiManager() {
        return {
            setLoading: (isLoading) => {
                if (!this.btnSubmit) return;
                this.btnSubmit.disabled = isLoading;
                if (this.spinner) {
                    this.spinner.style.display = isLoading ? 'inline-block' : 'none';
                }
                const btnText = this.btnSubmit.querySelector('span');
                if (btnText) {
                    btnText.textContent = isLoading ? 'Authenticating...' : 'Secure Login';
                }
            },
            showError: (message) => {
                if (this.errorContainer && this.errorMessage) {
                    this.errorMessage.textContent = message;
                    this.errorContainer.classList.remove('hidden');
                }
            },
            clearErrors: () => {
                if (this.errorContainer) {
                    this.errorContainer.classList.add('hidden');
                }
                document.querySelectorAll('.border-red-500').forEach(el => {
                    el.classList.remove('border-red-500');
                    el.classList.add('border-gray-300');
                });
            },
            showSuccess: (message) => {
                // Implementing a basic toast feedback (assuming toast element exists or is dynamically created)
                const toast = document.getElementById('successToast') || this.createDynamicToast();
                toast.textContent = message;
                toast.classList.remove('hidden');
            },
            focusField: (fieldId) => {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.focus();
                    field.classList.remove('border-gray-300');
                    field.classList.add('border-red-500');
                }
            },
            createDynamicToast: () => {
                const toast = document.createElement('div');
                toast.id = 'successToast';
                toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded shadow-lg hidden z-50';
                document.body.appendChild(toast);
                return toast;
            }
        };
    }
}
const microsoftBtn = document.getElementById("microsoftSignIn");

if (microsoftBtn) {

    microsoftBtn.addEventListener("click", async () => {

        try {

            microsoftBtn.disabled = true;

            const provider = new OAuthProvider("microsoft.com");

            const result = await signInWithPopup(auth, provider);

            console.log(result.user);

            window.location.href = "./client/dashboard.html";

        } catch (error) {

            console.error(error);

            alert(error.message);

        } finally {

            microsoftBtn.disabled = false;

        }

    });

}

const googleBtn = document.getElementById("googleSignIn");

if (googleBtn) {
    googleBtn.addEventListener("click", async () => {

        try {

            googleBtn.disabled = true;

            const provider = new GoogleAuthProvider();

            const result = await signInWithPopup(auth, provider);

            console.log(result.user);

            window.location.href = "./client/dashboard.html";

        } catch (error) {

            console.error(error);

            alert(error.message);

        } finally {

            googleBtn.disabled = false;

        }

    });
}



// Initialize the controller when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    new LoginController();
});
