javascript
/**
 * @fileoverview Registration Controller for MetaEscrow
 * @description Handles user onboarding, validation, Firebase Auth, and exact sequential ID generation.
 * @author Principal Architect
 * @version 1.0.0
 */

import {
    auth,
    db,
    createUserWithEmailAndPassword,
    deleteUser,
    doc,
    setDoc,
    getDoc,
    runTransaction,
    serverTimestamp
} from './firebase.js';

class RegistrationController {
    constructor() {
        // DOM Elements
        this.form = document.getElementById('registrationForm');
        this.btnSubmit = document.getElementById('btnSubmit');
        this.spinner = document.getElementById('loadingSpinner');
        this.errorContainer = document.getElementById('errorContainer');
        this.errorMessage = document.getElementById('errorMessage');
        this.successToast = document.getElementById('successToast');

        // Reserved Usernames
        this.RESERVED_USERNAMES = new Set([
            'admin', 'administrator', 'support', 'metaescrow', 
            'system', 'root', 'api', 'help', 'info', 'billing'
        ]);

        this.init();
    }

    /**
     * Initializes event listeners
     */
    init() {
        if (!this.form) return;

        // Real-time username formatting
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            usernameInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
            });
        }

        this.form.addEventListener('submit', (e) => this.handleRegistration(e));
    }

    /**
     * Main orchestration method for registration
     * @param {Event} event 
     */
    async handleRegistration(event) {
        event.preventDefault();
        
        this.uiManager.clearErrors();
        this.uiManager.setLoading(true);

        // 1. Gather & Sanitize Input
        const formData = {
            fullName: this.sanitizeFullName(document.getElementById('fullName').value),
            username: document.getElementById('username').value.trim().toLowerCase(),
            email: document.getElementById('email').value.trim().toLowerCase(),
            password: document.getElementById('password').value,
            confirmPassword: document.getElementById('confirmPassword').value,
            termsAgreed: document.getElementById('terms').checked
        };

        // 2. Client-Side Validation
        const validationErrors = this.validateInput(formData);
        if (validationErrors.length > 0) {
            this.uiManager.showError(validationErrors[0].message);
            this.uiManager.focusField(validationErrors[0].field);
            this.uiManager.setLoading(false);
            return;
        }

        let authUser = null;

        try {
            // 3. Pre-flight Check: Username Availability
            const isUsernameTaken = await this.checkUsernameExists(formData.username);
            if (isUsernameTaken) {
                throw { custom: true, field: 'username', message: 'This username is already taken. Please choose another.' };
            }

            // 4. Create Firebase Auth User
            const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
            authUser = userCredential.user;

            // 5. Generate Atomic Sequential Public ID (MES-000001)
            const publicUserId = await this.generatePublicId();

            // 6. Build and Save User Profile
            await this.createUserProfile(authUser.uid, publicUserId, formData);

            // 7. Register Username in global registry to prevent future duplicates
            await this.registerUsername(formData.username, authUser.uid);

            // 8. Post-Registration Cleanup & Redirect
            this.uiManager.showSuccess('Account created successfully! Redirecting...');
            this.form.reset();
            
            // Redirect to dashboard or email verification phase
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 2000);

        } catch (error) {
            console.error('[MetaEscrow Auth Error]:', error);

            // Rollback Authentication if profile creation failed midway
            if (authUser && !error.custom) {
                await this.rollbackAuth(authUser);
            }

            // Handle known Firebase errors
            let friendlyMessage = 'An unexpected error occurred. Please try again later.';
            let errorField = null;

            if (error.custom) {
                friendlyMessage = error.message;
                errorField = error.field;
            } else {
                switch (error.code) {
                    case 'auth/email-already-in-use':
                        friendlyMessage = 'An account with this email address already exists.';
                        errorField = 'email';
                        break;
                    case 'auth/invalid-email':
                        friendlyMessage = 'The email address is invalid.';
                        errorField = 'email';
                        break;
                    case 'auth/operation-not-allowed':
                        friendlyMessage = 'Registration is currently disabled. Please contact support.';
                        break;
                    case 'auth/weak-password':
                        friendlyMessage = 'The password provided is too weak.';
                        errorField = 'password';
                        break;
                    case 'auth/network-request-failed':
                        friendlyMessage = 'Network error. Please check your internet connection.';
                        break;
                    case 'auth/too-many-requests':
                        friendlyMessage = 'Too many attempts. Please try again later.';
                        break;
                }
            }

            this.uiManager.showError(friendlyMessage);
            if (errorField) this.uiManager.focusField(errorField);
            this.uiManager.setLoading(false);
        }
    }

    /**
     * Validates all form fields against business rules
     * @param {Object} data 
     * @returns {Array} Array of error objects { field, message }
     */
    validateInput(data) {
        const errors = [];

        // Full Name Validation
        const nameRegex = /^[a-zA-Z\s'-]+$/;
        if (!data.fullName) {
            errors.push({ field: 'fullName', message: 'Full name is required.' });
        } else if (data.fullName.length < 5 || data.fullName.length > 60) {
            errors.push({ field: 'fullName', message: 'Full name must be between 5 and 60 characters.' });
        } else if (!nameRegex.test(data.fullName)) {
            errors.push({ field: 'fullName', message: 'Full name cannot contain numbers or special symbols.' });
        }

        // Username Validation
        const usernameRegex = /^[a-z0-9._]+$/;
        if (!data.username) {
            errors.push({ field: 'username', message: 'Username is required.' });
        } else if (data.username.length < 4 || data.username.length > 20) {
            errors.push({ field: 'username', message: 'Username must be between 4 and 20 characters.' });
        } else if (!usernameRegex.test(data.username)) {
            errors.push({ field: 'username', message: 'Username can only contain letters, numbers, periods, and underscores.' });
        } else if (this.RESERVED_USERNAMES.has(data.username)) {
            errors.push({ field: 'username', message: 'This username is reserved and cannot be used.' });
        }

        // Email Validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!data.email) {
            errors.push({ field: 'email', message: 'Email address is required.' });
        } else if (!emailRegex.test(data.email)) {
            errors.push({ field: 'email', message: 'Please enter a valid email address.' });
        }

        // Password Validation
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;
        if (!data.password) {
            errors.push({ field: 'password', message: 'Password is required.' });
        } else if (!passwordRegex.test(data.password)) {
            errors.push({ field: 'password', message: 'Password must be 8-64 characters and contain uppercase, lowercase, number, and special character.' });
        }

        // Confirm Password Validation
        if (data.password !== data.confirmPassword) {
            errors.push({ field: 'confirmPassword', message: 'Passwords do not match.' });
        }

        // Terms Validation
        if (!data.termsAgreed) {
            errors.push({ field: 'terms', message: 'You must agree to the Terms of Service to continue.' });
        }

        return errors;
    }

    /**
     * Sanitizes full name by trimming and removing duplicate spaces
     * @param {string} name 
     * @returns {string}
     */
    sanitizeFullName(name) {
        return name.trim().replace(/\s+/g, ' ');
    }

    /**
     * Checks if a username is already registered
     * Uses a dedicated 'usernames' collection for fast O(1) lookups
     * @param {string} username 
     * @returns {Promise<boolean>}
     */
    async checkUsernameExists(username) {
        const usernameRef = doc(db, 'usernames', username);
        const docSnap = await getDoc(usernameRef);
        return docSnap.exists();
    }

    /**
     * Generates a sequential public ID using a Firestore Transaction
     * Prevents race conditions during high-volume signups
     * @returns {Promise<string>} e.g., 'MES-000001'
     */
    async generatePublicId() {
        const counterRef = doc(db, 'system', 'userMetadata');
        
        return await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let nextId = 1;

            if (!counterDoc.exists()) {
                // Initialize counter if it doesn't exist
                transaction.set(counterRef, { totalUsers: 1 });
            } else {
                nextId = (counterDoc.data().totalUsers || 0) + 1;
                transaction.update(counterRef, { totalUsers: nextId });
            }

            // Format ID with leading zeros
            const formattedId = String(nextId).padStart(6, '0');
            return `MES-${formattedId}`;
        });
    }

    /**
     * Creates the comprehensive user profile document in Firestore
     * @param {string} uid Firebase Internal ID
     * @param {string} publicUserId Generated Public ID
     * @param {Object} data Sanitized form data
     */
    async createUserProfile(uid, publicUserId, data) {
        const userRef = doc(db, 'users', uid);
        
        const profileData = {
            uid: uid,
            publicUserId: publicUserId,
            fullName: data.fullName,
            username: data.username,
            email: data.email,
            
            // System Defaults
            role: 'user',
            verificationStatus: 'unverified',
            accountStatus: 'active',
            profileImage: '',
            
            // Financial Balances (in lowest denomination, e.g., Kobo, or standard standard depending on arch, initializing to 0)
            walletBalance: 0,
            escrowBalance: 0,
            availableBalance: 0,
            pendingBalance: 0,
            
            // Escrow Metrics
            rating: null,
            reviewCount: 0,
            completedTransactions: 0,
            cancelledTransactions: 0,
            disputesWon: 0,
            disputesLost: 0,
            totalSales: 0,
            totalPurchases: 0,
            
            // Future Profile Extensions
            phone: '',
            address: '',
            country: '',
            state: '',
            city: '',
            bio: '',
            
            // Timestamps
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(userRef, profileData);
    }

    /**
     * Reserves the username in the global registry
     * @param {string} username 
     * @param {string} uid 
     */
    async registerUsername(username, uid) {
        const usernameRef = doc(db, 'usernames', username);
        await setDoc(usernameRef, { uid: uid, createdAt: serverTimestamp() });
    }

    /**
     * Compensating transaction: Deletes Firebase Auth user if DB setup fails
     * @param {Object} user Firebase User Object
     */
    async rollbackAuth(user) {
        try {
            await deleteUser(user);
            console.info('[MetaEscrow] Registration rolled back successfully due to database error.');
        } catch (rollbackError) {
            // Critical error: The user exists in Auth but has no profile.
            // In a production environment, this should trigger an alert to Sentry/Datadog.
            console.error('[MetaEscrow FATAL] Failed to rollback user auth:', rollbackError);
        }
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
                    btnText.textContent = isLoading ? 'Creating Account...' : 'Create Account';
                }
            },
            showError: (message) => {
                if (this.errorContainer && this.errorMessage) {
                    this.errorMessage.textContent = message;
                    this.errorContainer.classList.remove('hidden');
                } else {
                    // Fallback if Tailwind classes / containers aren't perfectly mapped
                    alert(message);
                }
            },
            clearErrors: () => {
                if (this.errorContainer) {
                    this.errorContainer.classList.add('hidden');
                }
                // Clear input highlights
                document.querySelectorAll('.border-red-500').forEach(el => {
                    el.classList.remove('border-red-500');
                    el.classList.add('border-gray-300'); // Assuming default tailwind border
                });
            },
            showSuccess: (message) => {
                if (this.successToast) {
                    this.successToast.textContent = message;
                    this.successToast.classList.remove('hidden');
                }
            },
            focusField: (fieldId) => {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.focus();
                    field.classList.remove('border-gray-300');
                    field.classList.add('border-red-500'); // Highlight error field
                }
            }
        };
    }
}

// Initialize the controller when DOM is fully loaded to ensure elements exist
document.addEventListener('DOMContentLoaded', () => {
    new RegistrationController();
});

