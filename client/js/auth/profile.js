/**
 * @fileoverview Identity and Profile Controller for MetaEscrow
 * @description Manages profile data, KYC workflows, security settings, and preferences.
 * @author Principal Identity Management Architect
 * @version 2.2.0
 */

import {
    auth,
    db,
    doc,
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    getDocs,
    updateDoc,
    addDoc,
    serverTimestamp,
    updatePassword
} from './firebase.js';

import { CurrentUser } from './authGuard.js';

class ProfileController {
    constructor() {
        this.unsubscribers = new Map();
        this.isProcessing = false;
        this.currentProfileData = null;

        // Initialize only after secure session is established
        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    /**
     * Bootstraps the controller and binds UI events
     */
    init() {
        if (!CurrentUser || !CurrentUser.uid) return;

        this.bindEvents();
        this.bootstrapProfile();
    }

    /**
     * Attaches event listeners to the profile forms and actions
     */
    bindEvents() {
        // Profile Update Form
        const profileForm = document.getElementById('formUpdateProfile');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => this.handleProfileUpdate(e));
        }

        // KYC Verification Form
        const kycForm = document.getElementById('formSubmitKYC');
        if (kycForm) {
            kycForm.addEventListener('submit', (e) => this.handleKYCSubmit(e));
        }

        // Security / Password Update Form
        const securityForm = document.getElementById('formChangePassword');
        if (securityForm) {
            securityForm.addEventListener('submit', (e) => this.handlePasswordChange(e));
        }

        // Preferences Form
        const preferencesForm = document.getElementById('formPreferences');
        if (preferencesForm) {
            preferencesForm.addEventListener('change', (e) => this.handlePreferenceUpdate(e));
        }
    }

    /**
     * Orchestrates the concurrent loading of profile resources
     */
    async bootstrapProfile() {
        this.uiManager.showSkeletons();

        // 1. Establish Realtime Profile Sync
        this.loadProfileRealtime();

        // 2. Load asynchronous historical data
        await Promise.allSettled([
            this.loadReviews(),
            this.loadActivity()
        ]);

        this.uiManager.hideSkeletons();
    }

    /**
     * Subscribes to the user document to ensure UI is always authoritative
     */
    loadProfileRealtime() {
        const userRef = doc(db, 'users', CurrentUser.uid);

        const unsub = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                this.currentProfileData = docSnap.data();
                this.uiManager.renderProfileData(this.currentProfileData);
                this.calculateProfileCompleteness(this.currentProfileData);
            }
        }, (error) => this.handleErrors('Profile Sync', error));

        this.unsubscribers.set('profile', unsub);
    }

    /**
     * Processes profile update requests safely
     * @param {Event} e 
     */
    async handleProfileUpdate(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const payload = this.uiManager.getProfileFormData();
        if (!this.validateProfile(payload)) return;

        this.isProcessing = true;
        this.uiManager.setLoading('btnSaveProfile', true);

        try {
            // Strip illegal fields to prevent privilege escalation via client manipulation
            const safeUpdate = {
                fullName: payload.fullName,
                phone: payload.phone,
                bio: payload.bio,
                country: payload.country,
                state: payload.state,
                city: payload.city,
                address: payload.address,
                profileImage: payload.profileImage,
                updatedAt: serverTimestamp()
            };

            const userRef = doc(db, 'users', CurrentUser.uid);
            await updateDoc(userRef, safeUpdate);

            await this.logAudit('PROFILE_UPDATED');
            this.uiManager.showSuccess('Profile updated successfully.');
            
        } catch (error) {
            this.handleErrors('Update Profile', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnSaveProfile', false);
        }
    }

    /**
     * Submits KYC verification request
     * @param {Event} e 
     */
    async handleKYCSubmit(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        // Check if already verified or pending
        if (this.currentProfileData?.verificationStatus === 'verified' || 
            this.currentProfileData?.verificationStatus === 'pending') {
            this.uiManager.showError('Your account is already verified or a request is pending.');
            return;
        }

        const payload = this.uiManager.getKYCFormData();
        if (!this.validateKYC(payload)) return;

        this.isProcessing = true;
        this.uiManager.setLoading('btnSubmitKYC', true);

        try {
            // 1. Create Verification Request Document
            const kycRef = collection(db, 'verificationRequests');
            await addDoc(kycRef, {
                uid: CurrentUser.uid,
                status: 'pending',
                documentUrls: {
                    nationalId: payload.nationalIdUrl,
                    selfie: payload.selfieUrl,
                    utilityBill: payload.utilityBillUrl
                },
                submittedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            // 2. Update User Profile Status
            const userRef = doc(db, 'users', CurrentUser.uid);
            await updateDoc(userRef, {
                verificationStatus: 'pending',
                updatedAt: serverTimestamp()
            });

            await this.logAudit('KYC_SUBMITTED');
            this.uiManager.showSuccess('Verification documents submitted. Please allow 24-48 hours for review.');
            this.uiManager.resetForm('formSubmitKYC');

        } catch (error) {
            this.handleErrors('KYC Submission', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnSubmitKYC', false);
        }
    }

    /**
     * Handles Firebase Authentication password update
     * @param {Event} e 
     */
    async handlePasswordChange(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const payload = this.uiManager.getPasswordFormData();
        if (!this.validatePassword(payload)) return;

        this.isProcessing = true;
        this.uiManager.setLoading('btnChangePassword', true);

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication context lost.");

            await updatePassword(user, payload.newPassword);

            await this.logAudit('PASSWORD_CHANGED');
            this.notifySystem('Your MetaEscrow password was recently changed. If this was not you, contact support immediately.');
            this.uiManager.showSuccess('Password updated successfully.');
            this.uiManager.resetForm('formChangePassword');

        } catch (error) {
            if (error.code === 'auth/requires-recent-login') {
                this.uiManager.showError('For security reasons, changing your password requires a recent login. Please log out and log back in, then try again.');
            } else {
                this.handleErrors('Password Change', error);
            }
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnChangePassword', false);
        }
    }

    /**
     * Updates notification and UI preferences
     * @param {Event} e 
     */
    async handlePreferenceUpdate(e) {
        const target = e.target;
        if (!target.name) return;

        try {
            const userRef = doc(db, 'users', CurrentUser.uid);
            
            // Uses dynamic property syntax to update nested Firestore object safely
            await updateDoc(userRef, {
                [`preferences.${target.name}`]: target.type === 'checkbox' ? target.checked : target.value
            });

        } catch (error) {
            this.handleErrors('Preference Update', error);
        }
    }

    /**
     * Calculates Profile Completeness entirely in-memory
     * @param {Object} data Profile Data
     */
    calculateProfileCompleteness(data) {
        if (!data) return;

        const criteria = [
            { key: 'fullName', weight: 15 },
            { key: 'phone', weight: 15 },
            { key: 'profileImage', weight: 10 },
            { key: 'address', weight: 10 },
            { key: 'bio', weight: 10 },
            { condition: data.verificationStatus === 'verified', weight: 40 }
        ];

        let score = 0;
        criteria.forEach(item => {
            if (item.condition !== undefined) {
                if (item.condition) score += item.weight;
            } else if (data[item.key] && data[item.key].trim() !== '') {
                score += item.weight;
            }
        });

        this.uiManager.renderCompletenessBar(score);
    }

    /**
     * Loads recent peer reviews asynchronously
     */
    async loadReviews() {
        try {
            const reviewsRef = collection(db, 'reviews');
            const q = query(
                reviewsRef,
                where('targetUserId', '==', CurrentUser.uid),
                orderBy('createdAt', 'desc'),
                limit(10)
            );
            
            const snapshot = await getDocs(q);
            this.uiManager.renderReviews(snapshot);
        } catch (error) {
            this.handleErrors('Load Reviews', error);
        }
    }

    /**
     * Loads recent account activity from audit logs
     */
    async loadActivity() {
        try {
            const activityRef = collection(db, 'auditLogs');
            const q = query(
                activityRef,
                where('uid', '==', CurrentUser.uid),
                orderBy('timestamp', 'desc'),
                limit(15)
            );
            
            const snapshot = await getDocs(q);
            this.uiManager.renderActivity(snapshot);
        } catch (error) {
            this.handleErrors('Load Activity', error);
        }
    }

    /**
     * Submits an internal notification
     * @param {string} message 
     */
    async notifySystem(message) {
        try {
            await addDoc(collection(db, 'notifications'), {
                uid: CurrentUser.uid,
                message: message,
                read: false,
                type: 'security',
                createdAt: serverTimestamp()
            });
        } catch (e) {
            console.warn('[Profile] System notification dispatch failed.', e);
        }
    }

    /**
     * Submits an immutable audit log
     * @param {string} action 
     */
    async logAudit(action) {
        try {
            await addDoc(collection(db, 'auditLogs'), {
                uid: CurrentUser.uid,
                action: action,
                timestamp: serverTimestamp(),
                userAgent: navigator.userAgent
            });
        } catch (e) {
            console.warn('[Profile] Audit log dispatch failed.', e);
        }
    }

    // --- Validation Helpers ---

    validateProfile(payload) {
        if (!payload.fullName || payload.fullName.length < 5 || payload.fullName.length > 60) {
            this.uiManager.showError("Full name must be between 5 and 60 characters.");
            return false;
        }
        
        // Basic Nigerian Phone Format Validation (e.g., 080..., +234...)
        const phoneRegex = /^(\+234|0)[789][01]\d{8}$/;
        if (payload.phone && !phoneRegex.test(payload.phone)) {
            this.uiManager.showError("Please enter a valid Nigerian phone number.");
            return false;
        }

        if (payload.bio && payload.bio.length > 500) {
            this.uiManager.showError("Bio cannot exceed 500 characters.");
            return false;
        }

        const urlRegex = /^https?:\/\/.+\..+/;
        if (payload.profileImage && !urlRegex.test(payload.profileImage)) {
            this.uiManager.showError("Please enter a valid Image URL.");
            return false;
        }

        return true;
    }

    validateKYC(payload) {
        const urlRegex = /^https?:\/\/.+\..+/;
        if (!urlRegex.test(payload.nationalIdUrl) || 
            !urlRegex.test(payload.selfieUrl) || 
            !urlRegex.test(payload.utilityBillUrl)) {
            this.uiManager.showError("All KYC fields must contain valid Image URLs.");
            return false;
        }
        return true;
    }

    validatePassword(payload) {
        if (payload.newPassword !== payload.confirmPassword) {
            this.uiManager.showError("Passwords do not match.");
            return false;
        }
        // Strong password regex: 8 chars, 1 upper, 1 lower, 1 num, 1 special
        const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;
        if (!strongRegex.test(payload.newPassword)) {
            this.uiManager.showError("Password must be 8+ characters, include uppercase, lowercase, number, and special character.");
            return false;
        }
        return true;
    }

    handleErrors(context, error) {
        console.error(`[MetaEscrow Profile] ${context} Error:`, error);
        let msg = "An unexpected error occurred. Please try again.";
        if (error.code === 'permission-denied') msg = "You do not have permission to perform this action.";
        this.uiManager.showError(msg);
    }

    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    /**
     * UI Element Manager to isolate DOM operations
     */
    get uiManager() {
        return {
            getProfileFormData: () => ({
                fullName: document.getElementById('profFullName')?.value.trim(),
                phone: document.getElementById('profPhone')?.value.trim(),
                bio: document.getElementById('profBio')?.value.trim(),
                country: document.getElementById('profCountry')?.value.trim(),
                state: document.getElementById('profState')?.value.trim(),
                city: document.getElementById('profCity')?.value.trim(),
                address: document.getElementById('profAddress')?.value.trim(),
                profileImage: document.getElementById('profImageUrl')?.value.trim()
            }),
            getKYCFormData: () => ({
                nationalIdUrl: document.getElementById('kycNationalId')?.value.trim(),
                selfieUrl: document.getElementById('kycSelfie')?.value.trim(),
                utilityBillUrl: document.getElementById('kycUtilityBill')?.value.trim()
            }),
            getPasswordFormData: () => ({
                newPassword: document.getElementById('secNewPassword')?.value,
                confirmPassword: document.getElementById('secConfirmPassword')?.value
            }),
            renderProfileData: (data) => {
                const safeBind = (id, val, isImage = false) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    if (isImage) {
                        el.src = val || 'default-avatar.png';
                    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                        el.value = val || '';
                    } else {
                        el.textContent = val || '';
                    }
                };

                // Bind Static Views
                safeBind('viewFullName', data.fullName);
                safeBind('viewUsername', `@${data.username}`);
                safeBind('viewPublicId', data.publicUserId);
                safeBind('viewEmail', data.email);
                safeBind('viewRole', data.role.toUpperCase());
                safeBind('viewVerification', data.verificationStatus.toUpperCase());
                safeBind('viewProfileImage', data.profileImage, true);
                
                // Seller Specific Views
                safeBind('statRating', data.rating ? `${data.rating} / 5` : 'No Ratings');
                safeBind('statReviewCount', `${data.reviewCount || 0} Reviews`);
                safeBind('statCompletedSales', data.completedTransactions || 0);

                // Bind Edit Form Inputs
                safeBind('profFullName', data.fullName);
                safeBind('profPhone', data.phone);
                safeBind('profBio', data.bio);
                safeBind('profCountry', data.country);
                safeBind('profState', data.state);
                safeBind('profCity', data.city);
                safeBind('profAddress', data.address);
                safeBind('profImageUrl', data.profileImage);
                
                // Bind Preferences
                if (data.preferences) {
                    const emailPref = document.getElementById('prefEmailNotifications');
                    if (emailPref) emailPref.checked = !!data.preferences.emailNotifications;
                }

                // Handle KYC UI State
                if (data.verificationStatus === 'verified' || data.verificationStatus === 'pending') {
                    const kycForm = document.getElementById('formSubmitKYC');
                    const kycNotice = document.getElementById('kycStatusNotice');
                    if (kycForm) kycForm.style.display = 'none';
                    if (kycNotice) {
                        kycNotice.style.display = 'block';
                        kycNotice.textContent = data.verificationStatus === 'verified' ? 'Account Verified.' : 'Verification Pending Review.';
                    }
                }
            },
            renderCompletenessBar: (score) => {
                const bar = document.getElementById('profileCompletenessBar');
                const text = document.getElementById('profileCompletenessText');
                if (bar) bar.style.width = `${score}%`;
                if (text) text.textContent = `${score}% Complete`;
            },
            renderReviews: (snapshot) => {
                const container = document.getElementById('reviewsContainer');
                if (!container) return;
                container.innerHTML = snapshot.empty ? '<p class="text-sm text-gray-500">No reviews yet.</p>' : '';
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const el = document.createElement('div');
                    el.className = 'py-3 border-b border-gray-100 last:border-0';
                    el.innerHTML = `
                        <div class="flex items-center mb-1">
                            <span class="text-yellow-400 text-sm font-bold mr-2">★ ${data.rating}</span>
                            <span class="text-xs text-gray-400">${new Date(data.createdAt?.toDate()).toLocaleDateString()}</span>
                        </div>
                        <p class="text-sm text-gray-700">${data.comment}</p>
                    `;
                    container.appendChild(el);
                });
            },
            renderActivity: (snapshot) => {
                const container = document.getElementById('activityContainer');
                if (!container) return;
                container.innerHTML = snapshot.empty ? '<p class="text-sm text-gray-500">No recent activity.</p>' : '';
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const el = document.createElement('div');
                    el.className = 'py-2 text-sm text-gray-600 flex justify-between';
                    el.innerHTML = `
                        <span>${data.action.replace(/_/g, ' ')}</span>
                        <span class="text-xs text-gray-400">${new Date(data.timestamp?.toDate()).toLocaleDateString()}</span>
                    `;
                    container.appendChild(el);
                });
            },
            setLoading: (btnId, isLoading) => {
                const btn = document.getElementById(btnId);
                if (btn) {
                    btn.disabled = isLoading;
                    btn.innerText = isLoading ? 'Processing...' : btn.getAttribute('data-original-text') || 'Submit';
                }
            },
            resetForm: (formId) => document.getElementById(formId)?.reset(),
            showSkeletons: () => document.querySelectorAll('.profile-skeleton').forEach(e => e.classList.remove('hidden')),
            hideSkeletons: () => document.querySelectorAll('.profile-skeleton').forEach(e => e.classList.add('hidden')),
            showSuccess: (msg) => alert(`Success: ${msg}`),
            showError: (msg) => alert(`Error: ${msg}`)
        };
    }
}

export const profileController = new ProfileController();

