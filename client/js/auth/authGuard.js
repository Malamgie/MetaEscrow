/**
 * @fileoverview Authentication & Authorization Guard for MetaEscrow
 * @description Secures protected routes, manages RBAC, and caches user sessions.
 * @author Principal Security Architect
 * @version 1.1.0
 */

import {
    auth,
    db,
    onAuthStateChanged,
    signOut,
    doc,
    getDoc
} from './firebase.js';

// Safe Global Object for UI consumption
export let CurrentUser = null;

class AuthGuard {
    constructor() {
        this.currentPath = window.location.pathname.toLowerCase();
        
        // Prevent UI Flashing immediately
        this.preventUIFlash();

        // Configuration
        this.CACHE_KEY = 'metaEscrow_secureSession';
        this.CACHE_TTL_MS = 1000 * 60 * 5; // 5 Minutes
        
        // Route Protection Definitions
        this.ADMIN_ROUTES = ['/admin.html', '/admin-dashboard.html', '/users.html'];
        this.MODERATOR_ROUTES = ['/disputes.html', '/moderator.html'];
        this.VERIFIED_ONLY_ROUTES = ['/high-value-escrow.html', '/withdraw-large.html'];
        
        // Routes that MUST bypass cache to prevent manual sessionStorage tampering
        this.STRICT_VERIFICATION_ROUTES = [...this.ADMIN_ROUTES, ...this.MODERATOR_ROUTES];

        this.init();
    }

    /**
     * Bootstraps the auth observer and UI states
     */
    init() {
        this.uiManager.showLoading('Verifying secure session...');
        this.observeAuthentication();
    }

    /**
     * Prevents content flashing by immediately hiding the document body
     */
    preventUIFlash() {
        const style = document.createElement('style');
        style.id = 'authGuard-anti-flash';
        style.innerHTML = `body { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.3s ease; }`;
        document.head.appendChild(style);
    }

    /**
     * Restores visibility once access is granted
     */
    restoreUI() {
        const style = document.getElementById('authGuard-anti-flash');
        if (style) {
            style.remove();
        }
        document.body.style.opacity = '1';
        document.body.style.pointerEvents = 'auto';
    }

    /**
     * Subscribes to Firebase Auth state changes
     */
    observeAuthentication() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                await this.processAuthenticatedUser(user);
            } else {
                this.redirectUnauthorized('/login.html');
            }
        });
    }

    /**
     * Main pipeline for authorized users
     * @param {Object} user Firebase Auth User
     */
    async processAuthenticatedUser(user) {
        try {
            const profile = await this.loadUserProfile(user.uid);

            if (!profile) {
                console.error('[MetaEscrow AuthGuard]: Profile missing for UID:', user.uid);
                await this.logoutUser('/error.html?reason=profile_missing');
                return;
            }

            // 1. Check Account Status (Bans/Suspensions)
            if (!this.verifyAccountStatus(profile.accountStatus)) return;

            // 2. Check Role-Based Access Control
            if (!this.verifyRole(profile.role, this.currentPath)) return;

            // 3. Check Verification Status for specific pages
            if (!this.verifyVerificationStatus(profile.verificationStatus, this.currentPath)) return;

            // Access Granted: Hydrate safe global object & expose UI
            this.hydrateGlobalUser(profile);
            this.cacheUser(profile);
            
            this.uiManager.hideLoading();
            this.restoreUI();

        } catch (error) {
            console.error('[MetaEscrow AuthGuard]: System Error:', error);
            this.uiManager.showError('Unable to verify security credentials. Please check your connection.');
        }
    }

    /**
     * Intelligently fetches profile from cache or Firestore
     * @param {string} uid 
     * @returns {Promise<Object|null>}
     */
    async loadUserProfile(uid) {
        const requiresLiveRead = this.STRICT_VERIFICATION_ROUTES.some(route => this.currentPath.includes(route));

        if (!requiresLiveRead) {
            const cached = this.restoreCache();
            if (cached && cached.uid === uid) {
                return cached;
            }
        }

        // Network Fetch
        const userRef = doc(db, 'users', uid);
        const docSnap = await getDoc(userRef);
        
        return docSnap.exists() ? docSnap.data() : null;
    }

    /**
     * Enforces Account Status rules
     * @param {string} status 
     * @returns {boolean} True if allowed to proceed
     */
    verifyAccountStatus(status) {
        switch (status) {
            case 'active':
                return true;
            case 'inactive':
                this.redirectUnauthorized('/activation.html');
                return false;
            case 'suspended':
                this.logoutUser('/suspended.html');
                return false;
            case 'banned':
                this.logoutUser('/banned.html');
                return false;
            default:
                this.logoutUser('/login.html');
                return false;
        }
    }

    /**
     * Enforces Role-Based Access Control
     * @param {string} role 
     * @param {string} path 
     * @returns {boolean} True if allowed to proceed
     */
    verifyRole(role, path) {
        const isAdminRoute = this.ADMIN_ROUTES.some(route => path.includes(route));
        const isModeratorRoute = this.MODERATOR_ROUTES.some(route => path.includes(route));

        if (isAdminRoute && role !== 'admin') {
            this.redirectUnauthorized('/dashboard.html?error=unauthorized');
            return false;
        }

        if (isModeratorRoute && role !== 'admin' && role !== 'moderator') {
            this.redirectUnauthorized('/dashboard.html?error=unauthorized');
            return false;
        }

        return true;
    }

    /**
     * Enforces Verification rules for specific features
     * @param {string} status 
     * @param {string} path 
     * @returns {boolean}
     */
    verifyVerificationStatus(status, path) {
        const isVerifiedOnly = this.VERIFIED_ONLY_ROUTES.some(route => path.includes(route));

        if (isVerifiedOnly && status !== 'verified') {
            this.redirectUnauthorized('/verify-account.html?reason=required');
            return false;
        }

        return true;
    }

    /**
     * Caches sanitized profile data into SessionStorage
     * @param {Object} profile 
     */
    cacheUser(profile) {
        const safeProfile = this.createSafeProfileClone(profile);
        const cachePayload = {
            data: safeProfile,
            timestamp: Date.now()
        };
        sessionStorage.setItem(this.CACHE_KEY, JSON.stringify(cachePayload));
    }

    /**
     * Retrieves valid cached profile if within TTL
     * @returns {Object|null}
     */
    restoreCache() {
        try {
            const raw = sessionStorage.getItem(this.CACHE_KEY);
            if (!raw) return null;

            const cachePayload = JSON.parse(raw);
            const isExpired = (Date.now() - cachePayload.timestamp) > this.CACHE_TTL_MS;

            if (isExpired) {
                sessionStorage.removeItem(this.CACHE_KEY);
                return null;
            }

            return cachePayload.data;
        } catch (e) {
            sessionStorage.removeItem(this.CACHE_KEY);
            return null;
        }
    }

    /**
     * Exposes ONLY safe fields to the Global object
     * @param {Object} profile 
     */
    hydrateGlobalUser(profile) {
        CurrentUser = this.createSafeProfileClone(profile);
        
        // Dispatch event for UI components to know user data is ready
        window.dispatchEvent(new CustomEvent('MetaEscrowUserReady', { detail: CurrentUser }));
    }

    /**
     * Utility to strip internal references before caching/exporting
     * @param {Object} profile 
     * @returns {Object}
     */
    createSafeProfileClone(profile) {
        return {
            uid: profile.uid,
            publicUserId: profile.publicUserId,
            username: profile.username,
            fullName: profile.fullName,
            role: profile.role,
            verificationStatus: profile.verificationStatus,
            walletBalance: profile.walletBalance || 0,
            availableBalance: profile.availableBalance || 0,
            pendingBalance: profile.pendingBalance || 0,
            escrowBalance: profile.escrowBalance || 0,
            rating: profile.rating || null,
            profileImage: profile.profileImage || ''
        };
    }

    /**
     * Purges session and Firebase Auth, then redirects
     * @param {string} redirectUrl 
     */
    async logoutUser(redirectUrl) {
        sessionStorage.removeItem(this.CACHE_KEY);
        CurrentUser = null;
        try {
            await signOut(auth);
        } catch (error) {
            console.error('[MetaEscrow] Error during forced logout:', error);
        } finally {
            window.location.replace(redirectUrl);
        }
    }

    /**
     * Redirects users safely without maintaining history state
     * @param {string} url 
     */
    redirectUnauthorized(url) {
        window.location.replace(url);
    }

    /**
     * Isolated UI Manager for AuthGuard specific overlays
     */
    get uiManager() {
        return {
            showLoading: (message) => {
                let loader = document.getElementById('metaEscrow-security-loader');
                if (!loader) {
                    loader = document.createElement('div');
                    loader.id = 'metaEscrow-security-loader';
                    // Applying inline styles to guarantee it works without external CSS dependencies
                    loader.style.cssText = `
                        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                        background: #ffffff; display: flex; flex-direction: column;
                        justify-content: center; align-items: center; z-index: 99999;
                        font-family: system-ui, -apple-system, sans-serif;
                    `;
                    document.body.appendChild(loader);
                }
                loader.innerHTML = `
                    <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #2563eb; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 1rem; color: #4b5563; font-weight: 500;">${message}</p>
                    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                `;
            },
            hideLoading: () => {
                const loader = document.getElementById('metaEscrow-security-loader');
                if (loader) loader.remove();
            },
            showError: (message) => {
                let loader = document.getElementById('metaEscrow-security-loader');
                if (loader) {
                    loader.innerHTML = `
                        <div style="color: #dc2626; font-size: 48px;">⚠️</div>
                        <p style="margin-top: 1rem; color: #1f2937; font-weight: 600;">Security Check Failed</p>
                        <p style="margin-top: 0.5rem; color: #4b5563;">${message}</p>
                        <button onclick="window.location.reload()" style="margin-top: 1.5rem; padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 0.375rem; cursor: pointer;">Retry</button>
                    `;
                }
            }
        };
    }
}

// Auto-initialize the guard as soon as the script loads
new AuthGuard();
