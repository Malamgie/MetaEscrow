/**
 * @fileoverview Dashboard Controller for MetaEscrow
 * @description Orchestrates data fetching, real-time subscriptions, and DOM updates for the main user dashboard.
 * @author Principal Software Architect
 * @version 1.2.0
 */

import {
    db,
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    getDocs,
    doc
} from 'js/firebase.js';

import { CurrentUser } from 'js/auth/authGuard.js';

class DashboardController {
    constructor() {
        this.unsubscribers = new Map();
        this.isLoaded = false;
        
        // Listen for the secure authentication event before bootstrapping
        window.addEventListener('MetaEscrowUserReady', () => this.init());
        
        // Bind manual refresh actions
        const refreshBtn = document.getElementById('btnRefreshDashboard');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshDashboard());
        }
    }

    /**
     * Initializes the dashboard once security context is verified
     */
    init() {
        if (!CurrentUser || !CurrentUser.uid) {
            console.error('[MetaEscrow] Dashboard initialization failed: No secure context.');
            return;
        }
        
        if (this.isLoaded) return; // Prevent duplicate initialization

        this.bootstrapDashboard();
        this.isLoaded = true;
    }

    /**
     * Orchestrates concurrent loading of all dashboard widgets
     */
    async bootstrapDashboard() {
        this.uiManager.showAllSkeletons();

        // 1. Synchronous UI Hydration (Fast)
        this.populateUserInfo();

        // 2. Real-time Subscriptions (Async but persistent)
        this.attachRealtimeListeners();

        // 3. Concurrent Static Fetches (Async, historical data)
        const fetchTasks = [
            this.loadEscrowSummary(),
            this.loadMarketplaceSummary(),
            this.loadRecentTransactions(),
            this.loadActivities()
        ];

        const results = await Promise.allSettled(fetchTasks);

        // Process failures without crashing the whole dashboard
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                this.handleErrors(`Task ${index}`, result.reason);
            }
        });

        this.uiManager.hideAllSkeletons();
    }

    /**
     * Binds user identity data to the DOM safely
     */
    populateUserInfo() {
        // Map backend roles to unified user tiers for the UI
        const tierMapping = {
            'user': 'Standard Account',
            'verified': 'Premium Account',
            'moderator': 'Moderator',
            'admin': 'System Administrator'
        };

        const displayTier = tierMapping[CurrentUser.role] || 'Standard Account';

        this.uiManager.safeBind('userFullName', CurrentUser.fullName);
        this.uiManager.safeBind('userUsername', `@${CurrentUser.username}`);
        this.uiManager.safeBind('userPublicId', CurrentUser.publicUserId);
        this.uiManager.safeBind('userAccountTier', displayTier);
        this.uiManager.safeBind('userVerification', CurrentUser.verificationStatus.toUpperCase());
        
        // Handle profile image dynamically
        const imgEl = document.getElementById('userProfileImage');
        if (imgEl && CurrentUser.profileImage) {
            imgEl.src = CurrentUser.profileImage;
        }
    }

    /**
     * Initializes all Firestore onSnapshot listeners
     */
    attachRealtimeListeners() {
        this.unsubscribeAll(); // Clean slate

        this.unsubscribers.set('wallet', this.loadWalletSummary());
        this.unsubscribers.set('notifications', this.loadNotifications());
    }

    /**
     * Real-time listener for financial balances
     * @returns {Function} Unsubscribe function
     */
    loadWalletSummary() {
        const userRef = doc(db, 'users', CurrentUser.uid);
        
        return onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // Formatting assuming lowest denomination (e.g., kobo/cents). Adjust formatter logic accordingly.
                this.uiManager.safeBind('walletBalance', this.formatCurrency(data.walletBalance));
                this.uiManager.safeBind('availableBalance', this.formatCurrency(data.availableBalance));
                this.uiManager.safeBind('escrowBalance', this.formatCurrency(data.escrowBalance));
                this.uiManager.safeBind('pendingBalance', this.formatCurrency(data.pendingBalance));
            }
        }, (error) => this.handleErrors('Wallet Realtime', error));
    }

    /**
     * Real-time listener for unread notifications
     * @returns {Function} Unsubscribe function
     */
    loadNotifications() {
        const notifRef = collection(db, 'notifications');
        const q = query(
            notifRef, 
            where('uid', '==', CurrentUser.uid),
            where('read', '==', false),
            orderBy('createdAt', 'desc'),
            limit(10)
        );

        return onSnapshot(q, (snapshot) => {
            this.uiManager.safeBind('unreadNotificationCount', snapshot.size.toString());
            this.uiManager.renderList('notificationList', snapshot, this.createNotificationNode);
        }, (error) => this.handleErrors('Notification Realtime', error));
    }

    /**
     * Fetches static escrow statistics
     */
    async loadEscrowSummary() {
        const escrowsRef = collection(db, 'escrows');
        const q = query(escrowsRef, where('participants', 'array-contains', CurrentUser.uid));
        
        const snapshot = await getDocs(q);
        
        let active = 0, completed = 0, disputed = 0;
        
        snapshot.forEach(doc => {
            const status = doc.data().status;
            if (status === 'active' || status === 'pending') active++;
            else if (status === 'completed') completed++;
            else if (status === 'disputed') disputed++;
        });

        this.uiManager.safeBind('statActiveEscrows', active.toString());
        this.uiManager.safeBind('statCompletedEscrows', completed.toString());
        this.uiManager.safeBind('statDisputedEscrows', disputed.toString());
    }

    /**
     * Fetches static marketplace statistics
     */
    async loadMarketplaceSummary() {
        const productsRef = collection(db, 'products');
        const q = query(productsRef, where('sellerId', '==', CurrentUser.uid));
        
        const snapshot = await getDocs(q);
        this.uiManager.safeBind('statProductsListed', snapshot.size.toString());
        
        // Additional complex queries (sold, purchased) would be aggregated via Cloud Functions
        // and read from a metadata document to save reads. Assumed metadata read here:
        this.uiManager.safeBind('statTotalSales', (CurrentUser.totalSales || 0).toString());
    }

    /**
     * Fetches recent transactional history
     */
    async loadRecentTransactions() {
        const txRef = collection(db, 'transactions');
        const q = query(
            txRef, 
            where('uid', '==', CurrentUser.uid),
            orderBy('timestamp', 'desc'),
            limit(5)
        );

        const snapshot = await getDocs(q);
        this.uiManager.renderList('recentTransactionsList', snapshot, this.createTransactionNode);
    }

    /**
     * Fetches recent system activity logs
     */
    async loadActivities() {
        const activityRef = collection(db, 'activityLogs');
        const q = query(
            activityRef,
            where('uid', '==', CurrentUser.uid),
            orderBy('timestamp', 'desc'),
            limit(5)
        );

        const snapshot = await getDocs(q);
        this.uiManager.renderList('recentActivityList', snapshot, this.createActivityNode);
    }

    /**
     * Centralized Error Handler
     * @param {string} context 
     * @param {Error} error 
     */
    handleErrors(context, error) {
        console.error(`[MetaEscrow Dashboard Error] - ${context}:`, error);
        // Dispatch to global toast/alert system if necessary
    }

    /**
     * Restarts the fetch process manually
     */
    refreshDashboard() {
        this.bootstrapDashboard();
    }

    /**
     * Clears all Firebase listeners to prevent memory leaks
     */
    unsubscribeAll() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    /**
     * Helper: Formats integers to localized currency strings
     * @param {number} amount 
     * @returns {string}
     */
    formatCurrency(amount) {
        const value = amount || 0;
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN'
        }).format(value);
    }

    // --- Node Creators for List Rendering ---

    createTransactionNode(data) {
        const li = document.createElement('li');
        li.className = 'py-3 flex justify-between items-center border-b border-gray-100 last:border-0';
        
        const desc = document.createElement('span');
        desc.className = 'text-sm font-medium text-gray-800';
        desc.textContent = data.description || 'Transaction';

        const amt = document.createElement('span');
        amt.className = `text-sm font-bold ${data.type === 'credit' ? 'text-green-600' : 'text-red-600'}`;
        amt.textContent = `${data.type === 'credit' ? '+' : '-'} NGN ${data.amount}`;

        li.appendChild(desc);
        li.appendChild(amt);
        return li;
    }

    createNotificationNode(data) {
        const div = document.createElement('div');
        div.className = 'p-3 mb-2 bg-blue-50 rounded shadow-sm text-sm text-gray-700';
        div.textContent = data.message;
        return div;
    }

    createActivityNode(data) {
        const p = document.createElement('p');
        p.className = 'text-xs text-gray-500 py-1';
        p.textContent = `• ${data.action} - ${new Date(data.timestamp?.toDate()).toLocaleDateString()}`;
        return p;
    }

    /**
     * UI Management encapsulation
     */
    get uiManager() {
        return {
            safeBind: (elementId, value) => {
                const el = document.getElementById(elementId);
                if (el) {
                    el.textContent = value;
                } else {
                    console.warn(`[MetaEscrow UI Warning] Element #${elementId} not found.`);
                }
            },
            showAllSkeletons: () => {
                document.querySelectorAll('.data-skeleton').forEach(el => {
                    el.classList.remove('hidden');
                    el.classList.add('animate-pulse');
                });
                document.querySelectorAll('.data-content').forEach(el => {
                    el.classList.add('hidden');
                });
            },
            hideAllSkeletons: () => {
                document.querySelectorAll('.data-skeleton').forEach(el => {
                    el.classList.add('hidden');
                    el.classList.remove('animate-pulse');
                });
                document.querySelectorAll('.data-content').forEach(el => {
                    el.classList.remove('hidden');
                });
            },
            renderList: (containerId, snapshot, nodeCreator) => {
                const container = document.getElementById(containerId);
                if (!container) return;
                
                container.innerHTML = ''; // Clear out skeleton or previous items safely
                
                if (snapshot.empty) {
                    const emptyState = document.createElement('div');
                    emptyState.className = 'text-gray-400 text-sm py-4 text-center';
                    emptyState.textContent = 'No recent records found.';
                    container.appendChild(emptyState);
                    return;
                }

                const fragment = document.createDocumentFragment();
                snapshot.forEach(doc => {
                    fragment.appendChild(nodeCreator(doc.data()));
                });
                container.appendChild(fragment);
            }
        };
    }
}

// Global instantiation
const dashboardInstance = new DashboardController();

// Export for teardown routing if using a custom SPA router
export const destroyDashboard = () => dashboardInstance.unsubscribeAll();
