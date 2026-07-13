/**
 * @fileoverview Core Escrow Lifecycle Controller for MetaEscrow
 * @description Manages secure escrow state transitions, fund locking/releasing, and dispute orchestration.
 * @author Principal FinTech Architect
 * @version 2.0.0
 */

import {
    db,
    doc,
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    runTransaction,
    addDoc,
    serverTimestamp
} from './firebase.js';

import { CurrentUser } from './authGuard.js';

class EscrowController {
    constructor() {
        this.unsubscribers = new Map();
        this.isProcessing = false;
        
        // Strict State Machine Definition
        this.VALID_TRANSITIONS = {
            'draft': ['pending_acceptance', 'cancelled'],
            'pending_acceptance': ['accepted', 'rejected', 'cancelled'],
            'accepted': ['funded', 'cancelled'],
            'funded': ['shipped', 'delivered', 'disputed', 'refunded'],
            'shipped': ['delivered', 'disputed'],
            'delivered': ['completed', 'disputed'],
            'disputed': ['resolved_refunded', 'resolved_released'],
            'completed': [],
            'cancelled': [],
            'refunded': []
        };

        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    init() {
        if (!CurrentUser || !CurrentUser.uid) return;
        this.bindEvents();
        this.listenRealtimeEscrows();
    }

    bindEvents() {
        const createForm = document.getElementById('formCreateEscrow');
        if (createForm) {
            createForm.addEventListener('submit', (e) => this.handleCreateEscrow(e));
        }
        
        // Action buttons use event delegation for dynamic lists
        document.body.addEventListener('click', (e) => {
            if (e.target.dataset.action) {
                this.routeAction(e.target.dataset.action, e.target.dataset.escrowId);
            }
        });
    }

    /**
     * Routes dynamic button clicks to appropriate lifecycle methods
     * @param {string} action 
     * @param {string} escrowId 
     */
    async routeAction(action, escrowId) {
        if (!escrowId || this.isProcessing) return;
        
        this.isProcessing = true;
        this.uiManager.setGlobalLoading(true);

        try {
            switch(action) {
                case 'accept': await this.acceptEscrow(escrowId); break;
                case 'reject': await this.rejectEscrow(escrowId); break;
                case 'fund': await this.fundEscrow(escrowId); break;
                case 'ship': await this.markShipped(escrowId); break;
                case 'deliver': await this.markDelivered(escrowId); break;
                case 'confirm': await this.releaseFunds(escrowId); break;
                case 'cancel': await this.cancelEscrow(escrowId); break;
                case 'dispute': await this.openDispute(escrowId); break;
                default: console.warn(`Unknown action: ${action}`);
            }
        } catch (error) {
            this.handleErrors(`Action [${action}]`, error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setGlobalLoading(false);
        }
    }

    /**
     * Initializes creation of a new escrow agreement
     * @param {Event} e 
     */
    async handleCreateEscrow(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const payload = this.uiManager.getCreateFormPayload();
        if (!this.validatePayload(payload)) return;

        this.isProcessing = true;
        this.uiManager.setLoading('btnCreateEscrow', true);

        try {
            const escrowId = this.generateEscrowId();
            const escrowRef = doc(db, 'escrows', escrowId);

            const escrowData = {
                escrowId: escrowId,
                title: payload.title,
                description: payload.description,
                category: payload.category,
                amount: parseFloat(payload.amount),
                buyerId: CurrentUser.uid,
                sellerId: payload.sellerId, // Assumes seller UI selection/validation
                status: 'pending_acceptance',
                inspectionPeriodDays: parseInt(payload.inspectionPeriod),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await runTransaction(db, async (transaction) => {
                transaction.set(escrowRef, escrowData);
            });

            await this.updateTimeline(escrowId, 'created', 'Escrow agreement generated.');
            await this.logAudit('ESCROW_CREATED', escrowId, 'draft', 'pending_acceptance');
            await this.notifyUser(payload.sellerId, `You have a new escrow request: ${payload.title}`);

            this.uiManager.showSuccess('Escrow created successfully.');
            this.uiManager.closeModals();
            
        } catch (error) {
            this.handleErrors('Create Escrow', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnCreateEscrow', false);
        }
    }

    /**
     * Seller accepts the terms
     * @param {string} escrowId 
     */
    async acceptEscrow(escrowId) {
        await this.executeStateTransition(escrowId, 'accepted', async (escrowDoc) => {
            const data = escrowDoc.data();
            if (data.sellerId !== CurrentUser.uid) throw new Error("Unauthorized: Only seller can accept.");
        });
        await this.updateTimeline(escrowId, 'accepted', 'Seller accepted the terms.');
    }

    /**
     * Funds the escrow, moving money atomically
     * @param {string} escrowId 
     */
    async fundEscrow(escrowId) {
        const escrowRef = doc(db, 'escrows', escrowId);
        const buyerRef = doc(db, 'users', CurrentUser.uid);
        const txRef = doc(collection(db, 'walletTransactions'));

        await runTransaction(db, async (transaction) => {
            const escrowDoc = await transaction.get(escrowRef);
            const buyerDoc = await transaction.get(buyerRef);

            if (!escrowDoc.exists() || !buyerDoc.exists()) throw new Error("Document missing.");
            const escData = escrowDoc.data();
            const buyerData = buyerDoc.data();

            // Authorization & State Validation
            if (escData.buyerId !== CurrentUser.uid) throw new Error("Unauthorized.");
            if (escData.status !== 'accepted') throw new Error(`Invalid transition from ${escData.status} to funded.`);
            
            // Financial Validation
            if (buyerData.availableBalance < escData.amount) throw { custom: true, message: "Insufficient available balance." };

            // Update Balances
            transaction.update(buyerRef, {
                availableBalance: buyerData.availableBalance - escData.amount,
                escrowBalance: (buyerData.escrowBalance || 0) + escData.amount
            });

            // Update Escrow State
            transaction.update(escrowRef, { 
                status: 'funded', 
                updatedAt: serverTimestamp(),
                fundedAt: serverTimestamp() 
            });

            // Log Transaction Ledger
            transaction.set(txRef, {
                uid: CurrentUser.uid,
                reference: `LOCK-${escData.escrowId}`,
                type: 'escrow_lock',
                amount: escData.amount,
                status: 'completed',
                escrowId: escrowId,
                timestamp: serverTimestamp()
            });
        });

        await this.updateTimeline(escrowId, 'funded', 'Funds successfully locked in escrow.');
        await this.logAudit('ESCROW_FUNDED', escrowId, 'accepted', 'funded');
    }

    /**
     * Confirms delivery and releases funds to seller
     * @param {string} escrowId 
     */
    async releaseFunds(escrowId) {
        const escrowRef = doc(db, 'escrows', escrowId);
        const txRefBuyer = doc(collection(db, 'walletTransactions'));
        const txRefSeller = doc(collection(db, 'walletTransactions'));

        await runTransaction(db, async (transaction) => {
            const escrowDoc = await transaction.get(escrowRef);
            if (!escrowDoc.exists()) throw new Error("Escrow missing.");
            
            const escData = escrowDoc.data();
            if (escData.buyerId !== CurrentUser.uid) throw new Error("Unauthorized. Only buyer can release.");
            if (!['shipped', 'delivered'].includes(escData.status)) throw new Error("Escrow not ready for release.");

            const buyerRef = doc(db, 'users', escData.buyerId);
            const sellerRef = doc(db, 'users', escData.sellerId);

            const buyerDoc = await transaction.get(buyerRef);
            const sellerDoc = await transaction.get(sellerRef);

            if (!buyerDoc.exists() || !sellerDoc.exists()) throw new Error("User document missing.");

            // 1. Remove from Buyer's Escrow Lock
            transaction.update(buyerRef, {
                escrowBalance: buyerDoc.data().escrowBalance - escData.amount
            });

            // 2. Add to Seller's Available Balance (Implementation note: Platform fees would be deducted here)
            transaction.update(sellerRef, {
                availableBalance: sellerDoc.data().availableBalance + escData.amount
            });

            // 3. Mark Escrow Completed
            transaction.update(escrowRef, {
                status: 'completed',
                updatedAt: serverTimestamp(),
                completedAt: serverTimestamp()
            });

            // 4. Ledger Entries
            transaction.set(txRefBuyer, {
                uid: escData.buyerId,
                reference: `REL-OUT-${escrowId}`,
                type: 'escrow_release_out',
                amount: escData.amount,
                status: 'completed',
                timestamp: serverTimestamp()
            });

            transaction.set(txRefSeller, {
                uid: escData.sellerId,
                reference: `REL-IN-${escrowId}`,
                type: 'escrow_release_in',
                amount: escData.amount,
                status: 'completed',
                timestamp: serverTimestamp()
            });
        });

        await this.updateTimeline(escrowId, 'completed', 'Buyer confirmed delivery. Funds released to seller.');
        await this.logAudit('ESCROW_COMPLETED', escrowId, 'delivered', 'completed');
        await this.notifyUser(null, `Escrow ${escrowId} completed successfully.`); // Notify both via cloud func trigger ideally
    }

    /**
     * Seller marks item as shipped
     * @param {string} escrowId 
     */
    async markShipped(escrowId) {
        await this.executeStateTransition(escrowId, 'shipped', async (escrowDoc) => {
            if (escrowDoc.data().sellerId !== CurrentUser.uid) throw new Error("Unauthorized.");
        });
        await this.updateTimeline(escrowId, 'shipped', 'Seller has marked the item as shipped.');
    }

    /**
     * Seller marks item as delivered
     * @param {string} escrowId 
     */
    async markDelivered(escrowId) {
        await this.executeStateTransition(escrowId, 'delivered', async (escrowDoc) => {
            if (escrowDoc.data().sellerId !== CurrentUser.uid) throw new Error("Unauthorized.");
        });
        await this.updateTimeline(escrowId, 'delivered', 'Item marked as delivered. Awaiting buyer confirmation.');
    }

    /**
     * Buyer or Seller opens a dispute
     * @param {string} escrowId 
     */
    async openDispute(escrowId) {
        await this.executeStateTransition(escrowId, 'disputed', async (escrowDoc) => {
            const data = escrowDoc.data();
            if (data.buyerId !== CurrentUser.uid && data.sellerId !== CurrentUser.uid) {
                throw new Error("Unauthorized to dispute.");
            }
        });
        await this.updateTimeline(escrowId, 'disputed', 'A dispute has been raised. Platform admin has been notified.');
        await this.logAudit('DISPUTE_OPENED', escrowId, 'various', 'disputed');
    }

    /**
     * Cancels an unfunded escrow
     * @param {string} escrowId 
     */
    async cancelEscrow(escrowId) {
        await this.executeStateTransition(escrowId, 'cancelled', async (escrowDoc) => {
            const data = escrowDoc.data();
            if (data.buyerId !== CurrentUser.uid && data.sellerId !== CurrentUser.uid) throw new Error("Unauthorized.");
            if (data.status === 'funded' || data.status === 'completed') throw new Error("Cannot cancel a funded or completed escrow.");
        });
        await this.updateTimeline(escrowId, 'cancelled', 'Escrow agreement was cancelled.');
    }

    /**
     * Generic atomic state transition executor
     * @param {string} escrowId 
     * @param {string} newStatus 
     * @param {Function} validationCallback 
     */
    async executeStateTransition(escrowId, newStatus, validationCallback = null) {
        const escrowRef = doc(db, 'escrows', escrowId);

        await runTransaction(db, async (transaction) => {
            const escrowDoc = await transaction.get(escrowRef);
            if (!escrowDoc.exists()) throw new Error("Escrow not found.");
            
            const currentStatus = escrowDoc.data().status;
            
            // State Machine Validation
            if (!this.VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
                throw new Error(`Illegal state transition from ${currentStatus} to ${newStatus}`);
            }

            // Custom Business Validation
            if (validationCallback) {
                await validationCallback(escrowDoc);
            }

            transaction.update(escrowRef, {
                status: newStatus,
                updatedAt: serverTimestamp()
            });
        });
    }

    /**
     * Subscribes to user's escrows for real-time dashboard updates
     */
    listenRealtimeEscrows() {
        const escrowsRef = collection(db, 'escrows');
        // Requires Firestore composite index for OR logic, MVP uses separate queries or cloud function aggregation
        // Simplified here for Buyer perspective:
        const qBuyer = query(escrowsRef, where('buyerId', '==', CurrentUser.uid), orderBy('updatedAt', 'desc'), limit(20));
        
        const unsub = onSnapshot(qBuyer, (snapshot) => {
            this.uiManager.renderEscrowList(snapshot);
        }, (error) => this.handleErrors('Realtime Sync', error));

        this.unsubscribers.set('buyerEscrows', unsub);
    }

    /**
     * Generates a collision-resistant Reference ID
     */
    generateEscrowId() {
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const random = Math.floor(Math.random() * 9000 + 1000);
        return `MES-ESC-${ymd}-${random}`;
    }

    /**
     * Writes to the immutable escrow timeline
     * @param {string} escrowId 
     * @param {string} action 
     * @param {string} description 
     */
    async updateTimeline(escrowId, action, description) {
        await addDoc(collection(db, 'escrowTimeline'), {
            escrowId: escrowId,
            action: action,
            description: description,
            uid: CurrentUser.uid,
            timestamp: serverTimestamp()
        });
    }

    /**
     * Writes to global compliance audit log
     */
    async logAudit(action, escrowId, oldStatus, newStatus) {
        await addDoc(collection(db, 'auditLogs'), {
            uid: CurrentUser.uid,
            action: action,
            targetId: escrowId,
            oldStatus: oldStatus,
            newStatus: newStatus,
            timestamp: serverTimestamp()
        });
    }

    /**
     * Dispatches platform notification
     */
    async notifyUser(targetUid, message) {
        // If targetUid is null, it typically signifies a broadcast to both parties via a backend trigger.
        if (!targetUid) return;
        await addDoc(collection(db, 'notifications'), {
            uid: targetUid,
            message: message,
            read: false,
            createdAt: serverTimestamp()
        });
    }

    validatePayload(payload) {
        if (!payload.title || !payload.amount || !payload.sellerId) {
            this.uiManager.showError("Please fill all required fields.");
            return false;
        }
        if (parseFloat(payload.amount) <= 0) {
            this.uiManager.showError("Amount must be greater than zero.");
            return false;
        }
        if (payload.sellerId === CurrentUser.uid) {
            this.uiManager.showError("You cannot create an escrow with yourself.");
            return false;
        }
        return true;
    }

    handleErrors(context, error) {
        console.error(`[MetaEscrow] ${context} Error:`, error);
        const msg = error.custom ? error.message : "An unexpected error occurred processing your request.";
        this.uiManager.showError(msg);
    }

    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    get uiManager() {
        return {
            getCreateFormPayload: () => ({
                title: document.getElementById('escTitle')?.value,
                description: document.getElementById('escDesc')?.value,
                category: document.getElementById('escCategory')?.value,
                amount: document.getElementById('escAmount')?.value,
                sellerId: document.getElementById('escSellerId')?.value,
                inspectionPeriod: document.getElementById('escInspection')?.value || 3
            }),
            setGlobalLoading: (isLoading) => {
                // Implement global spinner overlay
            },
            setLoading: (btnId, isLoading) => {
                const btn = document.getElementById(btnId);
                if (btn) {
                    btn.disabled = isLoading;
                    btn.innerText = isLoading ? 'Processing...' : btn.getAttribute('data-original-text') || 'Submit';
                }
            },
            renderEscrowList: (snapshot) => {
                const container = document.getElementById('escrowListContainer');
                if (!container) return;
                container.innerHTML = '';
                // Dynamic rendering logic here...
            },
            closeModals: () => {
                // Framework specific modal closing logic
            },
            showSuccess: (msg) => alert(`Success: ${msg}`),
            showError: (msg) => alert(`Error: ${msg}`)
        };
    }
}

export const escrowController = new EscrowController();
