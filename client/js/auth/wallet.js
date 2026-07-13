/**
 * @fileoverview Wallet Controller for MetaEscrow
 * @description Manages balances, funding, withdrawals, and transaction history.
 * @author Principal FinTech Architect
 * @version 1.5.0
 */

import {
    db,
    collection,
    doc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    getDocs,
    runTransaction,
    addDoc,
    serverTimestamp,
    startAfter
} from './firebase.js';

import { CurrentUser } from './authGuard.js';

class WalletController {
    constructor() {
        this.unsubscribers = new Map();
        this.currentLiveBalances = null;
        this.lastTransactionVisible = null;
        this.HISTORY_PAGE_SIZE = 15;
        this.isProcessing = false;

        // Await security context
        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    /**
     * Bootstraps the wallet once security is verified
     */
    init() {
        if (!CurrentUser || !CurrentUser.uid) return;

        this.bindEvents();
        this.bootstrapWallet();
    }

    /**
     * Attaches DOM event listeners securely
     */
    bindEvents() {
        const formFund = document.getElementById('formFundWallet');
        if (formFund) {
            formFund.addEventListener('submit', (e) => this.handleFundingSubmit(e));
        }

        const formWithdraw = document.getElementById('formWithdrawFunds');
        if (formWithdraw) {
            formWithdraw.addEventListener('submit', (e) => this.handleWithdrawalSubmit(e));
        }

        const btnLoadMore = document.getElementById('btnLoadMoreTransactions');
        if (btnLoadMore) {
            btnLoadMore.addEventListener('click', () => this.loadWalletHistory(true));
        }

        const filterSelect = document.getElementById('transactionFilter');
        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => this.filterTransactions(e.target.value));
        }
    }

    /**
     * Initiates concurrent loading processes
     */
    async bootstrapWallet() {
        this.uiManager.showSkeletons();

        this.loadBalances();
        await this.loadWalletHistory();

        this.uiManager.hideSkeletons();
    }

    /**
     * Subscribes to realtime balance changes
     */
    loadBalances() {
        const userRef = doc(db, 'users', CurrentUser.uid);

        const unsub = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                this.currentLiveBalances = docSnap.data();
                
                this.uiManager.updateBalances({
                    wallet: this.currentLiveBalances.walletBalance,
                    available: this.currentLiveBalances.availableBalance,
                    escrow: this.currentLiveBalances.escrowBalance,
                    pending: this.currentLiveBalances.pendingBalance
                });
            }
        }, (error) => this.handleErrors('Balance Sync', error));

        this.unsubscribers.set('balances', unsub);
    }

    /**
     * Fetches paginated transaction ledger
     * @param {boolean} loadMore If true, fetches next page
     */
    async loadWalletHistory(loadMore = false) {
        try {
            const txRef = collection(db, 'transactions');
            let q = query(
                txRef,
                where('uid', '==', CurrentUser.uid),
                orderBy('timestamp', 'desc'),
                limit(this.HISTORY_PAGE_SIZE)
            );

            if (loadMore && this.lastTransactionVisible) {
                q = query(q, startAfter(this.lastTransactionVisible));
            } else if (!loadMore) {
                this.uiManager.clearHistory();
            }

            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                this.lastTransactionVisible = snapshot.docs[snapshot.docs.length - 1];
                this.uiManager.renderTransactions(snapshot);
            } else if (!loadMore) {
                this.uiManager.showEmptyState();
            }

            this.uiManager.toggleLoadMoreButton(snapshot.docs.length === this.HISTORY_PAGE_SIZE);

        } catch (error) {
            this.handleErrors('Wallet History', error);
        }
    }

    /**
     * Processes Funding UI Submission
     * @param {Event} e 
     */
    async handleFundingSubmit(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const amountInput = document.getElementById('fundingAmount');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            this.uiManager.showError('Please enter a valid funding amount.');
            return;
        }

        this.isProcessing = true;
        this.uiManager.setLoading('btnSubmitFunding', true);

        try {
            await this.createFundingRequest(amount);
            this.uiManager.showSuccess('Funding request submitted. Awaiting admin approval.');
            amountInput.value = '';
            // Close modal/slideover logic here
        } catch (error) {
            this.handleErrors('Funding Request', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnSubmitFunding', false);
        }
    }

    /**
     * Creates a manual funding intent
     * MVP: Writes to transactions as pending, triggers notification
     * @param {number} amount 
     */
    async createFundingRequest(amount) {
        const reference = this.generateReference('DEP');
        const txData = {
            uid: CurrentUser.uid,
            reference: reference,
            type: 'deposit',
            amount: amount,
            status: 'pending_approval',
            description: 'Manual Wallet Funding',
            currency: 'NGN',
            timestamp: serverTimestamp()
        };

        // Write transaction
        await addDoc(collection(db, 'transactions'), txData);
        
        // Log Audit
        await this.logAudit('FUNDING_REQUESTED', amount, reference, 'success');
        
        // Notify System
        await this.notifyUser(`Your deposit request for ${this.formatCurrency(amount)} has been received and is pending review.`);
        
        // Refresh local history view to show pending transaction
        this.loadWalletHistory();
    }

    /**
     * Processes Withdrawal UI Submission
     * @param {Event} e 
     */
    async handleWithdrawalSubmit(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const amountInput = document.getElementById('withdrawalAmount');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            this.uiManager.showError('Please enter a valid withdrawal amount.');
            return;
        }

        if (!this.currentLiveBalances || amount > this.currentLiveBalances.availableBalance) {
            this.uiManager.showError('Insufficient available balance for this withdrawal.');
            return;
        }

        this.isProcessing = true;
        this.uiManager.setLoading('btnSubmitWithdrawal', true);

        try {
            await this.submitWithdrawal(amount);
            this.uiManager.showSuccess('Withdrawal request submitted successfully.');
            amountInput.value = '';
        } catch (error) {
            this.handleErrors('Withdrawal Request', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnSubmitWithdrawal', false);
        }
    }

    /**
     * Executes atomic withdrawal logic to prevent double-spending
     * Moves funds from Available to Pending, and creates transaction record.
     * @param {number} amount 
     */
    async submitWithdrawal(amount) {
        const userRef = doc(db, 'users', CurrentUser.uid);
        const txRef = doc(collection(db, 'transactions'));
        const reference = this.generateReference('WDL');

        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                throw new Error("User document does not exist.");
            }

            const currentAvailable = userDoc.data().availableBalance || 0;
            const currentPending = userDoc.data().pendingBalance || 0;

            // Strict server-side validation inside the atomic transaction
            if (currentAvailable < amount) {
                throw { custom: true, message: "Insufficient available balance." };
            }

            // Update Balances Safely
            transaction.update(userRef, {
                availableBalance: currentAvailable - amount,
                pendingBalance: currentPending + amount
            });

            // Create Pending Withdrawal Record
            transaction.set(txRef, {
                uid: CurrentUser.uid,
                reference: reference,
                type: 'withdrawal',
                amount: amount,
                status: 'pending_approval',
                description: 'Wallet Withdrawal',
                currency: 'NGN',
                timestamp: serverTimestamp()
            });
        });

        await this.logAudit('WITHDRAWAL_REQUESTED', amount, reference, 'success');
        await this.notifyUser(`Withdrawal request of ${this.formatCurrency(amount)} is currently pending processing.`);
        this.loadWalletHistory();
    }

    /**
     * Client-side UI filtering
     * @param {string} filterType 'all', 'deposit', 'withdrawal', etc.
     */
    filterTransactions(filterType) {
        const rows = document.querySelectorAll('.tx-row');
        rows.forEach(row => {
            if (filterType === 'all' || row.dataset.type === filterType) {
                row.style.display = 'flex'; // or whatever standard table-row display is used
            } else {
                row.style.display = 'none';
            }
        });
    }

    /**
     * Generates a collision-resistant scalable transaction reference
     * Format: MWT-YYYY-MMDD-HHMMSS-XXXX
     * @param {string} prefix 
     * @returns {string}
     */
    generateReference(prefix) {
        const now = new Date();
        const year = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const time = String(now.getTime()).slice(-6); // Last 6 digits of epoch
        const entropy = Math.floor(Math.random() * 9000 + 1000); // 4 digit random
        
        return `MWT-${prefix}-${year}${mm}${dd}-${time}-${entropy}`;
    }

    /**
     * Immutably logs financial intent for compliance
     * @param {string} action 
     * @param {number} amount 
     * @param {string} reference 
     * @param {string} status 
     */
    async logAudit(action, amount, reference, status) {
        await addDoc(collection(db, 'auditLogs'), {
            uid: CurrentUser.uid,
            action: action,
            amount: amount,
            reference: reference,
            status: status,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        });
    }

    /**
     * Centralized system notification dispatcher
     * @param {string} message 
     */
    async notifyUser(message) {
        await addDoc(collection(db, 'notifications'), {
            uid: CurrentUser.uid,
            message: message,
            read: false,
            type: 'financial',
            createdAt: serverTimestamp()
        });
    }

    /**
     * Currency formatter
     * @param {number} amount 
     * @returns {string}
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN'
        }).format(amount || 0);
    }

    /**
     * Centralized Error Handler
     * @param {string} context 
     * @param {Error} error 
     */
    handleErrors(context, error) {
        console.error(`[MetaEscrow Wallet] ${context} Error:`, error);
        
        let message = 'An unexpected system error occurred.';
        if (error.custom) {
            message = error.message;
        } else if (error.code === 'permission-denied') {
            message = 'Security exception: You do not have permission to perform this action.';
        }

        this.uiManager.showError(message);
        this.logAudit(`${context.toUpperCase()}_FAILED`, 0, 'SYS_ERR', 'failed').catch(() => {});
    }

    /**
     * Cleans up listeners on page destruction
     */
    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    /**
     * Encapsulates all DOM manipulation logic
     */
    get uiManager() {
        return {
            updateBalances: (balances) => {
                const safeSet = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = this.formatCurrency(val);
                };
                
                safeSet('valWalletBalance', balances.wallet);
                safeSet('valAvailableBalance', balances.available);
                safeSet('valEscrowBalance', balances.escrow);
                safeSet('valPendingBalance', balances.pending);
            },
            renderTransactions: (snapshot) => {
                const container = document.getElementById('transactionListContainer');
                if (!container) return;

                const fragment = document.createDocumentFragment();
                
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    
                    const div = document.createElement('div');
                    div.className = 'tx-row flex justify-between items-center p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors';
                    div.dataset.type = data.type;
                    
                    // Transaction Meta
                    const metaDiv = document.createElement('div');
                    const title = document.createElement('p');
                    title.className = 'text-sm font-semibold text-gray-800';
                    title.textContent = data.description;
                    
                    const refDate = document.createElement('p');
                    refDate.className = 'text-xs text-gray-500 mt-1';
                    refDate.textContent = `${data.reference} • ${data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'Just now'}`;
                    
                    metaDiv.appendChild(title);
                    metaDiv.appendChild(refDate);

                    // Transaction Amounts & Status
                    const valDiv = document.createElement('div');
                    valDiv.className = 'text-right';
                    
                    const amt = document.createElement('p');
                    const isCredit = ['deposit', 'escrow_release', 'refund'].includes(data.type);
                    amt.className = `text-sm font-bold ${isCredit ? 'text-green-600' : 'text-gray-800'}`;
                    amt.textContent = `${isCredit ? '+' : '-'} ${this.formatCurrency(data.amount)}`;

                    const statusBadge = document.createElement('span');
                    statusBadge.className = `text-[10px] uppercase font-bold px-2 py-1 rounded-full mt-1 inline-block 
                        ${data.status === 'completed' ? 'bg-green-100 text-green-700' : 
                          data.status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700' : 
                          'bg-red-100 text-red-700'}`;
                    statusBadge.textContent = data.status.replace('_', ' ');

                    valDiv.appendChild(amt);
                    valDiv.appendChild(statusBadge);

                    div.appendChild(metaDiv);
                    div.appendChild(valDiv);
                    fragment.appendChild(div);
                });

                container.appendChild(fragment);
            },
            clearHistory: () => {
                const container = document.getElementById('transactionListContainer');
                if (container) container.innerHTML = '';
            },
            showEmptyState: () => {
                const container = document.getElementById('transactionListContainer');
                if (container) {
                    container.innerHTML = '<div class="p-8 text-center text-gray-500 text-sm">No recent transactions found.</div>';
                }
            },
            setLoading: (btnId, isLoading) => {
                const btn = document.getElementById(btnId);
                if (!btn) return;
                btn.disabled = isLoading;
                btn.style.opacity = isLoading ? '0.7' : '1';
                btn.textContent = isLoading ? 'Processing...' : btn.getAttribute('data-original-text') || 'Submit';
            },
            showSkeletons: () => {
                document.querySelectorAll('.wallet-skeleton').forEach(el => el.classList.remove('hidden'));
                document.querySelectorAll('.wallet-data').forEach(el => el.classList.add('hidden'));
            },
            hideSkeletons: () => {
                document.querySelectorAll('.wallet-skeleton').forEach(el => el.classList.add('hidden'));
                document.querySelectorAll('.wallet-data').forEach(el => el.classList.remove('hidden'));
            },
            toggleLoadMoreButton: (show) => {
                const btn = document.getElementById('btnLoadMoreTransactions');
                if (btn) btn.style.display = show ? 'block' : 'none';
            },
            showSuccess: (msg) => alert(`Success: ${msg}`), // Replace with actual toast
            showError: (msg) => alert(`Error: ${msg}`)      // Replace with actual toast
        };
    }
}

// Global Instantiation
export const walletController = new WalletController();
