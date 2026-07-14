/**
 * @fileoverview Administration Controller for MetaEscrow
 * @description Centralized command module for financial approvals, user moderation, and dispute resolution.
 * @author Principal Enterprise Architect
 * @version 2.5.0
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
    getCountFromServer,
    runTransaction,
    addDoc,
    serverTimestamp,
    startAfter
} from './js/firebase.js';

import { CurrentUser } from './authGuard.js';

class AdminController {
    constructor() {
        this.unsubscribers = new Map();
        this.isProcessing = false;
        
        // Pagination cursors
        this.cursors = {
            users: null,
            transactions: null,
            escrows: null,
            products: null
        };
        
        this.PAGE_SIZE = 25;

        // Ensure security context is fully hydrated before init
        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    /**
     * Bootstraps the Admin Panel
     */
    init() {
        if (!CurrentUser || CurrentUser.uid === undefined) return;
        
        // Strict secondary authorization check
        if (CurrentUser.role !== 'admin') {
            console.error('[MetaEscrow Security] Unauthorized access attempt to Admin module.');
            window.location.replace('/dashboard.html?error=unauthorized_admin');
            return;
        }

        this.bindEvents();
        this.bootstrapAdminData();
    }

    /**
     * Binds global event delegates for administrative actions
     */
    bindEvents() {
        const adminContainer = document.getElementById('adminContainer');
        if (adminContainer) {
            adminContainer.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const targetId = e.target.dataset.id;
                
                if (!action || !targetId || this.isProcessing) return;

                this.routeAction(action, targetId, e.target);
            });
        }
    }

    /**
     * Routes actions to specific operational methods
     * @param {string} action 
     * @param {string} targetId 
     * @param {HTMLElement} element 
     */
    async routeAction(action, targetId, element) {
        this.isProcessing = true;
        this.uiManager.setLoading(element, true);

        try {
            switch (action) {
                // Wallet Approvals
                case 'approve_funding': await this.processFunding(targetId, true); break;
                case 'reject_funding': await this.processFunding(targetId, false); break;
                case 'approve_withdrawal': await this.processWithdrawal(targetId, true); break;
                case 'reject_withdrawal': await this.processWithdrawal(targetId, false); break;
                
                // User Management
                case 'suspend_user': await this.moderateUser(targetId, 'suspended'); break;
                case 'ban_user': await this.moderateUser(targetId, 'banned'); break;
                case 'activate_user': await this.moderateUser(targetId, 'active'); break;
                case 'verify_user': await this.updateUserVerification(targetId, 'verified'); break;
                
                // Escrow & Disputes
                case 'resolve_dispute_buyer': await this.resolveDispute(targetId, 'buyer'); break;
                case 'resolve_dispute_seller': await this.resolveDispute(targetId, 'seller'); break;
                case 'resolve_dispute_split': await this.resolveDispute(targetId, 'split'); break;
                
                // Marketplace
                case 'reject_listing': await this.moderateListing(targetId, 'rejected'); break;
                case 'hide_listing': await this.moderateListing(targetId, 'hidden'); break;
                
                default: console.warn(`[Admin] Unhandled action: ${action}`);
            }
        } catch (error) {
            this.handleErrors(`Admin Action [${action}]`, error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading(element, false);
        }
    }

    /**
     * Loads the high-level dashboard metrics concurrently
     */
    async bootstrapAdminData() {
        this.uiManager.showDashboardSkeletons();

        try {
            const usersRef = collection(db, 'users');
            const escrowsRef = collection(db, 'escrows');
            const txRef = collection(db, 'walletTransactions');

            // Use getCountFromServer for scalable metric aggregation
            const queries = [
                getCountFromServer(usersRef),
                getCountFromServer(query(usersRef, where('verificationStatus', '==', 'pending'))),
                getCountFromServer(query(escrowsRef, where('status', '==', 'disputed'))),
                getCountFromServer(query(txRef, where('status', '==', 'pending_approval')))
            ];

            const results = await Promise.allSettled(queries);

            this.uiManager.updateDashboardMetrics({
                totalUsers: results[0].status === 'fulfilled' ? results[0].value.data().count : 'Error',
                pendingVerifications: results[1].status === 'fulfilled' ? results[1].value.data().count : 'Error',
                activeDisputes: results[2].status === 'fulfilled' ? results[2].value.data().count : 'Error',
                pendingFinancials: results[3].status === 'fulfilled' ? results[3].value.data().count : 'Error'
            });

            // Initialize real-time queues
            this.listenToPendingFinancials();
            this.listenToDisputes();

        } catch (error) {
            this.handleErrors('Dashboard Bootstrap', error);
        } finally {
            this.uiManager.hideDashboardSkeletons();
        }
    }

    /**
     * Atomically processes a funding (deposit) request
     * @param {string} txId 
     * @param {boolean} isApproved 
     */
    async processFunding(txId, isApproved) {
        const txRef = doc(db, 'walletTransactions', txId);

        let actionReason = 'Approved by administration.';
        if (!isApproved) {
            actionReason = prompt("Enter reason for rejection:") || "Rejected by administration.";
            if (actionReason.trim() === '') throw { custom: true, message: "Reason is required for rejection." };
        }

        await runTransaction(db, async (transaction) => {
            const txDoc = await transaction.get(txRef);
            if (!txDoc.exists()) throw new Error("Transaction not found.");

            const txData = txDoc.data();
            if (txData.status !== 'pending_approval') {
                throw { custom: true, message: "Transaction has already been processed by another admin." };
            }

            const newStatus = isApproved ? 'completed' : 'rejected';
            
            // If approved, credit user wallet
            if (isApproved) {
                const userRef = doc(db, 'users', txData.uid);
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists()) throw new Error("User associated with transaction not found.");
                
                transaction.update(userRef, {
                    availableBalance: (userDoc.data().availableBalance || 0) + txData.amount
                });
            }

            transaction.update(txRef, {
                status: newStatus,
                adminNotes: actionReason,
                processedAt: serverTimestamp(),
                processedBy: CurrentUser.uid
            });
        });

        await this.logAdminAction(isApproved ? 'FUNDING_APPROVED' : 'FUNDING_REJECTED', txId, actionReason);
        await this.notifyUser(txId, `Your deposit request has been ${isApproved ? 'approved' : 'rejected'}.`);
        this.uiManager.showSuccess(`Funding request ${isApproved ? 'approved' : 'rejected'} successfully.`);
    }

    /**
     * Atomically processes a withdrawal request
     * @param {string} txId 
     * @param {boolean} isApproved 
     */
    async processWithdrawal(txId, isApproved) {
        const txRef = doc(db, 'walletTransactions', txId);

        let actionReason = 'Approved and disbursed by administration.';
        if (!isApproved) {
            actionReason = prompt("Enter reason for rejection:") || "Rejected by administration.";
            if (actionReason.trim() === '') throw { custom: true, message: "Reason is required for rejection." };
        }

        await runTransaction(db, async (transaction) => {
            const txDoc = await transaction.get(txRef);
            if (!txDoc.exists()) throw new Error("Transaction not found.");

            const txData = txDoc.data();
            if (txData.status !== 'pending_approval') {
                throw { custom: true, message: "Transaction has already been processed." };
            }

            const userRef = doc(db, 'users', txData.uid);
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("User not found.");

            const userData = userDoc.data();
            const newStatus = isApproved ? 'completed' : 'rejected';

            if (isApproved) {
                // The funds were already moved to pendingBalance during withdrawal request creation in wallet.js
                // We simply deduct from pendingBalance here to finalize.
                if (userData.pendingBalance < txData.amount) {
                    throw new Error("System Error: Pending balance is less than withdrawal amount.");
                }
                transaction.update(userRef, {
                    pendingBalance: userData.pendingBalance - txData.amount
                });
            } else {
                // If rejected, refund the locked amount from pendingBalance back to availableBalance
                transaction.update(userRef, {
                    pendingBalance: userData.pendingBalance - txData.amount,
                    availableBalance: userData.availableBalance + txData.amount
                });
            }

            transaction.update(txRef, {
                status: newStatus,
                adminNotes: actionReason,
                processedAt: serverTimestamp(),
                processedBy: CurrentUser.uid
            });
        });

        await this.logAdminAction(isApproved ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED', txId, actionReason);
        await this.notifyUser(txId, `Your withdrawal request has been ${isApproved ? 'approved' : 'rejected'}.`);
        this.uiManager.showSuccess(`Withdrawal ${isApproved ? 'approved' : 'rejected'} successfully.`);
    }

    /**
     * Atomically resolves a disputed escrow transaction
     * @param {string} escrowId 
     * @param {string} decision 'buyer', 'seller', or 'split'
     */
    async resolveDispute(escrowId, decision) {
        const resolutionNotes = prompt("Enter detailed resolution reasoning for the audit log:");
        if (!resolutionNotes) return;

        const escrowRef = doc(db, 'escrows', escrowId);

        await runTransaction(db, async (transaction) => {
            const escrowDoc = await transaction.get(escrowRef);
            if (!escrowDoc.exists()) throw new Error("Escrow not found.");
            
            const escData = escrowDoc.data();
            if (escData.status !== 'disputed') throw { custom: true, message: "Escrow is not currently in dispute." };

            const buyerRef = doc(db, 'users', escData.buyerId);
            const sellerRef = doc(db, 'users', escData.sellerId);

            const buyerDoc = await transaction.get(buyerRef);
            const sellerDoc = await transaction.get(sellerRef);

            if (!buyerDoc.exists() || !sellerDoc.exists()) throw new Error("Participant documents missing.");

            const totalAmount = escData.amount;
            let buyerRefund = 0;
            let sellerRelease = 0;

            if (decision === 'buyer') {
                buyerRefund = totalAmount;
            } else if (decision === 'seller') {
                sellerRelease = totalAmount;
            } else if (decision === 'split') {
                buyerRefund = totalAmount / 2;
                sellerRelease = totalAmount / 2;
            }

            // Remove full amount from buyer's locked escrow balance
            transaction.update(buyerRef, {
                escrowBalance: buyerDoc.data().escrowBalance - totalAmount,
                availableBalance: buyerDoc.data().availableBalance + buyerRefund
            });

            if (sellerRelease > 0) {
                transaction.update(sellerRef, {
                    availableBalance: sellerDoc.data().availableBalance + sellerRelease
                });
            }

            transaction.update(escrowRef, {
                status: 'resolved',
                resolution: decision,
                resolutionNotes: resolutionNotes,
                resolvedAt: serverTimestamp(),
                resolvedBy: CurrentUser.uid
            });
            
            // System ledger logging inside the transaction
            const auditRef = doc(collection(db, 'auditLogs'));
            transaction.set(auditRef, {
                adminId: CurrentUser.uid,
                action: 'DISPUTE_RESOLVED',
                targetId: escrowId,
                details: { decision, buyerRefund, sellerRelease, notes: resolutionNotes },
                timestamp: serverTimestamp()
            });
        });

        this.uiManager.showSuccess('Dispute resolved successfully. Funds have been routed according to the decision.');
    }

    /**
     * Changes operational status of a user
     * @param {string} userId 
     * @param {string} status 
     */
    async moderateUser(userId, status) {
        const reason = prompt(`Reason for setting user to ${status}:`);
        if (!reason) return;

        const userRef = doc(db, 'users', userId);
        
        await runTransaction(db, async (transaction) => {
            transaction.update(userRef, {
                accountStatus: status,
                statusUpdatedAt: serverTimestamp(),
                statusUpdatedBy: CurrentUser.uid,
                statusNotes: reason
            });
        });

        await this.logAdminAction(`USER_${status.toUpperCase()}`, userId, reason);
        this.uiManager.showSuccess(`User status updated to ${status}.`);
    }

    /**
     * Updates Marketplace listing status
     * @param {string} productId 
     * @param {string} status 
     */
    async moderateListing(productId, status) {
        const reason = prompt(`Reason for marking listing as ${status}:`);
        if (!reason) return;

        const prodRef = doc(db, 'products', productId);
        
        await runTransaction(db, async (transaction) => {
            transaction.update(prodRef, {
                status: status,
                moderatedAt: serverTimestamp(),
                moderatedBy: CurrentUser.uid,
                moderationReason: reason
            });
        });

        await this.logAdminAction(`LISTING_MODERATED_${status.toUpperCase()}`, productId, reason);
        this.uiManager.showSuccess(`Listing status updated to ${status}.`);
    }

    /**
     * Centralized immutable audit logger
     * @param {string} action 
     * @param {string} targetId 
     * @param {string} details 
     */
    async logAdminAction(action, targetId, details = '') {
        const auditData = {
            adminUid: CurrentUser.uid,
            adminPublicId: CurrentUser.publicUserId,
            action: action,
            targetId: targetId,
            details: details,
            timestamp: serverTimestamp()
        };
        await addDoc(collection(db, 'auditLogs'), auditData);
    }

    /**
     * Dispatches notification to a user based on target ID lookup
     * @param {string} txId 
     * @param {string} message 
     */
    async notifyUser(txId, message) {
        try {
            // Need to lookup UID from txId
            // In a production system, a Cloud Function Trigger on the document update is safer, 
            // but for client-side admin orchestration:
            const txDoc = await getDocs(query(collection(db, 'walletTransactions'), where('__name__', '==', txId)));
            if (!txDoc.empty) {
                const uid = txDoc.docs[0].data().uid;
                await addDoc(collection(db, 'notifications'), {
                    uid: uid,
                    message: message,
                    read: false,
                    type: 'admin_update',
                    createdAt: serverTimestamp()
                });
            }
        } catch (e) {
            console.warn('[Admin] Notification dispatch failed:', e);
        }
    }

    /**
     * Real-time listener for Financial Queues
     */
    listenToPendingFinancials() {
        const txRef = collection(db, 'walletTransactions');
        const q = query(txRef, where('status', '==', 'pending_approval'), orderBy('timestamp', 'asc'));
        
        const unsub = onSnapshot(q, (snapshot) => {
            this.uiManager.renderFinancialQueue(snapshot);
        }, (error) => this.handleErrors('Financial Queue Sync', error));

        this.unsubscribers.set('financialQueue', unsub);
    }

    /**
     * Real-time listener for Active Disputes
     */
    listenToDisputes() {
        const escRef = collection(db, 'escrows');
        const q = query(escRef, where('status', '==', 'disputed'), orderBy('updatedAt', 'asc'));
        
        const unsub = onSnapshot(q, (snapshot) => {
            this.uiManager.renderDisputeQueue(snapshot);
        }, (error) => this.handleErrors('Dispute Queue Sync', error));

        this.unsubscribers.set('disputeQueue', unsub);
    }

    /**
     * Global Error Handler
     * @param {string} context 
     * @param {Error} error 
     */
    handleErrors(context, error) {
        console.error(`[MetaEscrow Admin] ${context} Error:`, error);
        const msg = error.custom ? error.message : "A critical system error occurred. Action aborted to ensure integrity.";
        this.uiManager.showError(msg);
        
        // Log failures to audit trail for security monitoring
        this.logAdminAction(`SYSTEM_ERROR_${context}`, 'SYS', msg).catch(()=>console.error("Audit log failed."));
    }

    /**
     * Cleans up listeners
     */
    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    /**
     * UI Abstraction Layer
     */
    get uiManager() {
        return {
            updateDashboardMetrics: (metrics) => {
                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = val;
                };
                setVal('metricTotalUsers', metrics.totalUsers);
                setVal('metricPendingVerifications', metrics.pendingVerifications);
                setVal('metricActiveDisputes', metrics.activeDisputes);
                setVal('metricPendingFinancials', metrics.pendingFinancials);
            },
            renderFinancialQueue: (snapshot) => {
                const container = document.getElementById('financialQueueContainer');
                if (!container) return;
                
                container.innerHTML = '';
                if (snapshot.empty) {
                    container.innerHTML = '<div class="p-4 text-center text-gray-500">No pending requests.</div>';
                    return;
                }

                // Render secure DOM elements representing pending deposits/withdrawals
                // utilizing e.target.dataset.action = 'approve_funding' etc.
            },
            renderDisputeQueue: (snapshot) => {
                // Render logic for disputes table
            },
            showDashboardSkeletons: () => {
                document.querySelectorAll('.admin-metric-value').forEach(el => {
                    el.classList.add('animate-pulse', 'bg-gray-200', 'text-transparent', 'rounded');
                });
            },
            hideDashboardSkeletons: () => {
                document.querySelectorAll('.admin-metric-value').forEach(el => {
                    el.classList.remove('animate-pulse', 'bg-gray-200', 'text-transparent', 'rounded');
                });
            },
            setLoading: (element, isLoading) => {
                if (element) {
                    element.disabled = isLoading;
                    element.style.opacity = isLoading ? '0.5' : '1';
                    element.innerText = isLoading ? 'Processing...' : element.getAttribute('data-original-text') || 'Action';
                }
            },
            showSuccess: (msg) => alert(`Admin Success: ${msg}`),
            showError: (msg) => alert(`Admin Alert: ${msg}`)
        };
    }
}

export const adminController = new AdminController();
