/**
 * @fileoverview Secure Logout Controller for MetaEscrow
 * @description Safely terminates sessions, clears sensitive caches, and orchestrates cross-tab synchronization.
 * @author Principal Security Architect
 * @version 1.1.0
 */

import { auth, signOut } from './firebase.js';

class LogoutController {
    constructor() {
        // Namespace used across the application for storage keys
        this.STORAGE_PREFIX = 'metaescrow_';
        
        // State lock to prevent race conditions
        this.isProcessing = false;

        this.init();
    }

    /**
     * Initializes listeners for logout actions and cross-tab synchronization
     */
    init() {
        // Bind to all elements with data-action="logout"
        const logoutTriggers = document.querySelectorAll('[data-action="logout"]');
        logoutTriggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => this.handleLogout(e, trigger));
        });

        // Listen for logout events triggered by other tabs
        window.addEventListener('storage', (e) => this.syncMultiTabLogout(e));
    }

    /**
     * Main execution pipeline for the logout sequence
     * @param {Event} event 
     * @param {HTMLElement} triggerElement 
     */
    async handleLogout(event, triggerElement) {
        if (event) event.preventDefault();
        
        // Prevent concurrent logout attempts
        if (this.isProcessing) return;
        this.isProcessing = true;

        this.uiManager.showLoading(triggerElement);

        try {
            // 1. Terminate Firebase Session
            await this.executeFirebaseLogout();

            // 2. Erase Client-Side Footprint
            this.clearClientState();

            // 3. Trigger Cross-Tab Synchronization
            this.broadcastLogoutToOtherTabs();

            // 4. Secure Redirection (wipes BFCache)
            this.secureRedirect();

        } catch (error) {
            console.error('[MetaEscrow Logout Error]:', error);
            this.uiManager.showError('An error occurred while logging out. Forcibly clearing session.');
            
            // Fallback: Always clear state and redirect even if network fails
            this.clearClientState();
            this.secureRedirect();
        } finally {
            this.isProcessing = false;
            this.uiManager.hideLoading(triggerElement);
        }
    }

    /**
     * Revokes the Firebase Authentication token
     */
    async executeFirebaseLogout() {
        // Check if there is an active session before attempting to sign out
        if (auth.currentUser) {
            await signOut(auth);
        }
    }

    /**
     * Dynamically sweeps and destroys all MetaEscrow namespaced data from browser storage
     */
    clearClientState() {
        // Clear sessionStorage
        const sessionKeysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.toLowerCase().startsWith(this.STORAGE_PREFIX)) {
                sessionKeysToRemove.push(key);
            }
        }
        sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

        // Clear localStorage
        const localKeysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.toLowerCase().startsWith(this.STORAGE_PREFIX)) {
                localKeysToRemove.push(key);
            }
        }
        localKeysToRemove.forEach(key => localStorage.removeItem(key));

        // Nullify global object if it exists (from authGuard.js)
        if (window.CurrentUser !== undefined) {
            window.CurrentUser = null;
        }
    }

    /**
     * Emits a signal to other open tabs to execute local cleanup
     */
    broadcastLogoutToOtherTabs() {
        const triggerKey = `${this.STORAGE_PREFIX}logout_trigger`;
        localStorage.setItem(triggerKey, Date.now().toString());
        // Immediately remove it to keep storage clean
        localStorage.removeItem(triggerKey);
    }

    /**
     * Listens for the cross-tab logout signal
     * @param {StorageEvent} event 
     */
    syncMultiTabLogout(event) {
        if (event.key === `${this.STORAGE_PREFIX}logout_trigger`) {
            // Another tab initiated logout. Clean up this tab and redirect.
            this.clearClientState();
            this.secureRedirect();
        }
    }

    /**
     * Neutralizes the DOM and replaces the history state to prevent Back-button access
     */
    secureRedirect() {
        // Prevent Back-Forward Cache (BFCache) leaks by clearing the DOM
        document.body.style.display = 'none';
        document.body.innerHTML = '';
        
        // Use replace to overwrite current history entry
        window.location.replace('/login.html?status=logged_out');
    }

    /**
     * UI State Management for the logout process
     */
    get uiManager() {
        return {
            showLoading: (element) => {
                if (!element) return;
                element.style.pointerEvents = 'none';
                element.style.opacity = '0.7';
                
                // Assuming standard text within the button, append or change to spinner text
                const originalText = element.getAttribute('data-original-text') || element.innerText;
                element.setAttribute('data-original-text', originalText);
                element.innerText = 'Logging out...';
            },
            hideLoading: (element) => {
                if (!element) return;
                element.style.pointerEvents = 'auto';
                element.style.opacity = '1';
                
                const originalText = element.getAttribute('data-original-text');
                if (originalText) {
                    element.innerText = originalText;
                }
            },
            showError: (message) => {
                // In a true logout failure, alerting is often the most reliable cross-UI method
                // since the user might be stuck in a broken state
                alert(message);
            }
        };
    }
}

// Instantiate controller to bind global listeners immediately
document.addEventListener('DOMContentLoaded', () => {
    new LogoutController();
});
