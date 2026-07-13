/**
 * @fileoverview Enterprise Notification Controller for MetaEscrow
 * @description Manages real-time alerts, paginated history, bulk actions, and critical acknowledgements.
 * @author Principal Enterprise Systems Architect
 * @version 1.0.0
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
    updateDoc,
    writeBatch,
    addDoc,
    serverTimestamp,
    startAfter
} from './firebase.js';

import { CurrentUser } from './authGuard.js';

class NotificationController {
    constructor() {
        this.PAGE_SIZE = 20;
        this.lastVisibleDoc = null;
        this.unsubscribers = new Map();
        this.isProcessing = false;
        
        this.filters = {
            status: 'all', // all, unread, read, archived
            type: 'all',   // all, wallet, escrow, security, etc.
            searchTerm: ''
        };

        // Await security context
        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    /**
     * Bootstraps the Notification System
     */
    init() {
        if (!CurrentUser || !CurrentUser.uid) return;

        this.bindEvents();
        this.loadUnreadCount();
        this.loadNotifications(true);
    }

    /**
     * Binds DOM events using event delegation
     */
    bindEvents() {
        // Event delegation for notification actions
        const container = document.getElementById('notificationsContainer');
        if (container) {
            container.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const notifId = e.target.dataset.id;
                const priority = e.target.dataset.priority;

                if (!action || !notifId || this.isProcessing) return;

                switch (action) {
                    case 'markRead': this.markAsRead(notifId, priority); break;
                    case 'archive': this.archiveNotification(notifId); break;
                    case 'delete': this.deleteNotification(notifId); break;
                }
            });
        }

        // Global Actions
        const btnMarkAll = document.getElementById('btnMarkAllRead');
        if (btnMarkAll) btnMarkAll.addEventListener('click', () => this.markAllAsRead());

        const btnLoadMore = document.getElementById('btnLoadMoreNotifications');
        if (btnLoadMore) btnLoadMore.addEventListener('click', () => this.loadNotifications(false));

        // Filters and Search
        const searchInput = document.getElementById('searchNotifications');
        if (searchInput) {
            let timeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this.filters.searchTerm = e.target.value.toLowerCase().trim();
                    this.loadNotifications(true);
                }, 400);
            });
        }

        const filterType = document.getElementById('filterNotificationType');
        if (filterType) filterType.addEventListener('change', (e) => {
            this.filters.type = e.target.value;
            this.loadNotifications(true);
        });

        const filterStatus = document.getElementById('filterNotificationStatus');
        if (filterStatus) filterStatus.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.loadNotifications(true);
        });
    }

    /**
     * Establishes real-time listener for the unread badge and urgent alerts
     */
    loadUnreadCount() {
        const notifRef = collection(db, 'notifications');
        const q = query(
            notifRef,
            where('uid', '==', CurrentUser.uid),
            where('status', '==', 'unread'),
            orderBy('createdAt', 'desc'),
            limit(50) // Limit to prevent massive reads on highly inactive accounts
        );

        const unsub = onSnapshot(q, (snapshot) => {
            let unreadCount = snapshot.size;
            const hasMore = unreadCount === 50 ? '50+' : unreadCount;
            
            this.uiManager.updateBadgeCount(hasMore);

            // Check for incoming critical alerts
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.priority === 'critical') {
                        this.uiManager.showCriticalAlert(change.doc.id, data);
                    } else if (data.createdAt && (Date.now() - data.createdAt.toDate().getTime() < 10000)) {
                        // Only toast if it was created in the last 10 seconds (prevents toast spam on load)
                        this.uiManager.showToast(data.title);
                    }
                }
            });
        }, (error) => this.handleErrors('Realtime Badge Sync', error));

        this.unsubscribers.set('unreadBadge', unsub);
    }

    /**
     * Builds the Firestore query based on active filters
     * @returns {Query}
     */
    buildQuery() {
        const notifRef = collection(db, 'notifications');
        const constraints = [
            where('uid', '==', CurrentUser.uid),
            where('status', '!=', 'deleted'), // Never fetch soft-deleted
            orderBy('status', 'asc'),         // Required for inequality filter
            orderBy('createdAt', 'desc'),
            limit(this.PAGE_SIZE)
        ];

        if (this.filters.type !== 'all') {
            constraints.push(where('type', '==', this.filters.type));
        }

        if (this.filters.status !== 'all') {
            // Adjust the base status inequality if a specific status is requested
            // Note: Requires composite index if both type and status equality/inequality are mixed
            // Rebuilding constraints for specific status to avoid Firestore limitations
            constraints.length = 0; 
            constraints.push(
                where('uid', '==', CurrentUser.uid),
                where('status', '==', this.filters.status),
                orderBy('createdAt', 'desc'),
                limit(this.PAGE_SIZE)
            );
            if (this.filters.type !== 'all') constraints.push(where('type', '==', this.filters.type));
        }

        if (this.lastVisibleDoc) {
            constraints.push(startAfter(this.lastVisibleDoc));
        }

        return query(notifRef, ...constraints);
    }

    /**
     * Fetches paginated notification history
     * @param {boolean} resetCursor 
     */
    async loadNotifications(resetCursor = false) {
        if (resetCursor) {
            this.lastVisibleDoc = null;
            this.uiManager.clearList();
        }

        this.uiManager.setLoading('btnLoadMoreNotifications', true);
        if (resetCursor) this.uiManager.showSkeletons();

        try {
            const q = this.buildQuery();
            const snapshot = await getDocs(q);

            let results = [];
            snapshot.forEach(doc => results.push({ id: doc.id, ...doc.data() }));

            // Client-side text search (MVP mitigation for NoSQL limitations)
            if (this.filters.searchTerm) {
                const term = this.filters.searchTerm;
                results = results.filter(n => 
                    (n.title && n.title.toLowerCase().includes(term)) || 
                    (n.message && n.message.toLowerCase().includes(term)) ||
                    (n.referenceId && n.referenceId.toLowerCase().includes(term))
                );
            }

            if (results.length > 0) {
                this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
                this.uiManager.renderNotifications(results);
            } else if (resetCursor) {
                this.uiManager.showEmptyState('No notifications found.');
            }

            this.uiManager.toggleLoadMore(snapshot.docs.length === this.PAGE_SIZE);

        } catch (error) {
            this.handleErrors('Load Notifications', error);
        } finally {
            this.uiManager.setLoading('btnLoadMoreNotifications', false);
            this.uiManager.hideSkeletons();
        }
    }

    /**
     * Marks a single notification as read
     * @param {string} notifId 
     * @param {string} priority 
     */
    async markAsRead(notifId, priority) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const notifRef = doc(db, 'notifications', notifId);
            await updateDoc(notifRef, {
                status: 'read',
                readAt: serverTimestamp()
            });

            // Critical alerts require immutable acknowledgement logging
            if (priority === 'critical') {
                await addDoc(collection(db, 'auditLogs'), {
                    uid: CurrentUser.uid,
                    action: 'CRITICAL_ALERT_ACKNOWLEDGED',
                    targetId: notifId,
                    timestamp: serverTimestamp()
                });
            }

            this.uiManager.updateVisualState(notifId, 'read');

        } catch (error) {
            this.handleErrors('Mark as Read', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Bulk updates all unread notifications to read (Chunked to bypass 500 limit)
     */
    async markAllAsRead() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.uiManager.setGlobalLoading(true);

        try {
            const unreadQuery = query(
                collection(db, 'notifications'),
                where('uid', '==', CurrentUser.uid),
                where('status', '==', 'unread')
                // Note: We deliberately do NOT mark 'critical' as read in bulk.
                // Depending on data volume, filtering priority client-side or via query is needed.
            );

            const snapshot = await getDocs(unreadQuery);
            if (snapshot.empty) return;

            // Chunk operations into batches of 450 (Firestore limit is 500)
            const chunks = [];
            let currentChunk = [];
            
            snapshot.docs.forEach(docSnap => {
                // Skip critical alerts for bulk actions
                if (docSnap.data().priority !== 'critical') {
                    currentChunk.push(docSnap.ref);
                    if (currentChunk.length === 450) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                    }
                }
            });
            if (currentChunk.length > 0) chunks.push(currentChunk);

            for (const chunk of chunks) {
                const batch = writeBatch(db);
                chunk.forEach(ref => {
                    batch.update(ref, { status: 'read', readAt: serverTimestamp() });
                });
                await batch.commit();
            }

            this.uiManager.showSuccess('All eligible notifications marked as read.');
            this.loadNotifications(true); // Refresh feed

        } catch (error) {
            this.handleErrors('Mark All Read', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setGlobalLoading(false);
        }
    }

    /**
     * Archives a notification
     * @param {string} notifId 
     */
    async archiveNotification(notifId) {
        try {
            const notifRef = doc(db, 'notifications', notifId);
            await updateDoc(notifRef, { status: 'archived', updatedAt: serverTimestamp() });
            this.uiManager.removeElement(notifId);
        } catch (error) {
            this.handleErrors('Archive', error);
        }
    }

    /**
     * Soft-deletes a notification
     * @param {string} notifId 
     */
    async deleteNotification(notifId) {
        if (!confirm("Remove this notification?")) return;
        try {
            const notifRef = doc(db, 'notifications', notifId);
            await updateDoc(notifRef, { status: 'deleted', updatedAt: serverTimestamp() });
            this.uiManager.removeElement(notifId);
        } catch (error) {
            this.handleErrors('Delete', error);
        }
    }

    /**
     * Updates delivery preferences in the master user document
     * @param {Object} preferencesPayload 
     */
    async updatePreferences(preferencesPayload) {
        try {
            const userRef = doc(db, 'users', CurrentUser.uid);
            await updateDoc(userRef, { notificationPreferences: preferencesPayload });
            this.uiManager.showSuccess('Notification preferences updated.');
        } catch (error) {
            this.handleErrors('Preferences', error);
        }
    }

    /**
     * Centralized Error Handling
     * @param {string} context 
     * @param {Error} error 
     */
    handleErrors(context, error) {
        console.error(`[MetaEscrow Notifications] ${context} Error:`, error);
        const msg = error.code === 'permission-denied' 
            ? "You do not have permission to access these notifications." 
            : "An error occurred updating your notifications.";
        this.uiManager.showError(msg);
    }

    /**
     * Cleanup listener logic
     */
    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers.clear();
    }

    /**
     * UI Isolation Layer
     */
    get uiManager() {
        return {
            updateBadgeCount: (count) => {
                const badges = document.querySelectorAll('.notif-badge');
                badges.forEach(badge => {
                    badge.textContent = count;
                    badge.style.display = count === 0 ? 'none' : 'inline-flex';
                });
            },
            renderNotifications: (notificationsData) => {
                const container = document.getElementById('notificationsContainer');
                if (!container) return;

                const fragment = document.createDocumentFragment();
                notificationsData.forEach(data => {
                    const el = document.createElement('div');
                    const isUnread = data.status === 'unread';
                    const isCritical = data.priority === 'critical';
                    
                    el.id = `notif_${data.id}`;
                    el.className = `p-4 border-b border-gray-100 flex flex-col gap-2 transition-colors
                        ${isUnread ? 'bg-blue-50/50' : 'bg-white'} 
                        ${isCritical ? 'border-l-4 border-l-red-500' : ''}`;

                    const header = document.createElement('div');
                    header.className = 'flex justify-between items-start';
                    
                    const title = document.createElement('h4');
                    title.className = `text-sm font-semibold ${isUnread ? 'text-gray-900' : 'text-gray-600'}`;
                    title.textContent = data.title;

                    const time = document.createElement('span');
                    time.className = 'text-xs text-gray-400';
                    time.textContent = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString() : 'Just now';

                    header.appendChild(title);
                    header.appendChild(time);

                    const message = document.createElement('p');
                    message.className = 'text-sm text-gray-600';
                    message.textContent = data.message;

                    const actions = document.createElement('div');
                    actions.className = 'flex gap-3 mt-2';

                    if (isUnread) {
                        const btnRead = document.createElement('button');
                        btnRead.className = 'text-xs text-blue-600 font-medium hover:underline';
                        btnRead.textContent = isCritical ? 'Acknowledge' : 'Mark as read';
                        btnRead.dataset.action = 'markRead';
                        btnRead.dataset.id = data.id;
                        btnRead.dataset.priority = data.priority;
                        actions.appendChild(btnRead);
                    }

                    if (!isCritical) {
                        const btnArchive = document.createElement('button');
                        btnArchive.className = 'text-xs text-gray-500 hover:underline';
                        btnArchive.textContent = 'Archive';
                        btnArchive.dataset.action = 'archive';
                        btnArchive.dataset.id = data.id;
                        actions.appendChild(btnArchive);
                    }

                    el.appendChild(header);
                    el.appendChild(message);
                    el.appendChild(actions);
                    fragment.appendChild(el);
                });

                container.appendChild(fragment);
            },
            updateVisualState: (id, status) => {
                const el = document.getElementById(`notif_${id}`);
                if (el && status === 'read') {
                    el.classList.remove('bg-blue-50/50');
                    el.classList.add('bg-white');
                    const title = el.querySelector('h4');
                    if (title) {
                        title.classList.remove('text-gray-900');
                        title.classList.add('text-gray-600');
                    }
                    const readBtn = el.querySelector('[data-action="markRead"]');
                    if (readBtn) readBtn.remove();
                }
            },
            removeElement: (id) => {
                const el = document.getElementById(`notif_${id}`);
                if (el) el.remove();
            },
            clearList: () => {
                const container = document.getElementById('notificationsContainer');
                if (container) container.innerHTML = '';
            },
            showEmptyState: (msg) => {
                const container = document.getElementById('notificationsContainer');
                if (container) {
                    container.innerHTML = `<div class="p-8 text-center text-gray-500 text-sm">${msg}</div>`;
                }
            },
            showToast: (msg) => {
                // Implement UI Toast logic
                console.log(`[Toast Notification]: ${msg}`);
            },
            showCriticalAlert: (id, data) => {
                // Implement un-dismissable modal UI logic for critical alerts
                alert(`CRITICAL ALERT: ${data.title}\n${data.message}`);
            },
            toggleLoadMore: (show) => {
                const btn = document.getElementById('btnLoadMoreNotifications');
                if (btn) btn.style.display = show ? 'block' : 'none';
            },
            setLoading: (btnId, isLoading) => {
                const btn = document.getElementById(btnId);
                if (btn) btn.disabled = isLoading;
            },
            setGlobalLoading: (isLoading) => {
                // Trigger global spinner overlay
            },
            showSkeletons: () => {
                const skels = document.querySelectorAll('.notif-skeleton');
                skels.forEach(s => s.classList.remove('hidden'));
            },
            hideSkeletons: () => {
                const skels = document.querySelectorAll('.notif-skeleton');
                skels.forEach(s => s.classList.add('hidden'));
            },
            showSuccess: (msg) => console.log(`Success: ${msg}`),
            showError: (msg) => console.error(`Error: ${msg}`)
        };
    }
}

export const notificationController = new NotificationController();
