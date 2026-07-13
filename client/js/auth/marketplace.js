/**
 * @fileoverview Marketplace Controller for MetaEscrow
 * @description Manages product discovery, listing lifecycle, vendor rules, and Escrow handoff.
 * @author Principal E-Commerce Architect
 * @version 2.1.0
 */

import {
    db,
    collection,
    doc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    startAfter
} from './firebase.js';

import { CurrentUser } from './authGuard.js';

class MarketplaceController {
    constructor() {
        this.PAGE_SIZE = 20;
        this.lastVisibleDoc = null;
        this.currentFilters = {
            category: null,
            searchTerm: null,
            minPrice: null,
            maxPrice: null,
            sort: 'newest'
        };
        
        this.isProcessing = false;

        // Boot after Auth Guard verifies context
        window.addEventListener('MetaEscrowUserReady', () => this.init());
    }

    init() {
        if (!CurrentUser || !CurrentUser.uid) return;
        
        this.bindEvents();
        this.loadMarketplace();
    }

    bindEvents() {
        // Event delegation for dynamic marketplace actions
        const marketplaceContainer = document.getElementById('marketplaceContainer');
        if (marketplaceContainer) {
            marketplaceContainer.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const productId = e.target.dataset.id;
                
                if (!action || !productId) return;
                
                switch (action) {
                    case 'buy': this.buyNow(productId); break;
                    case 'favorite': this.toggleFavorite(productId); break;
                    case 'edit': this.initiateEdit(productId); break;
                    case 'delete': this.deleteListing(productId); break;
                }
            });
        }

        // Filters and Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            // Debounce search
            let timeout = null;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this.currentFilters.searchTerm = e.target.value.trim().toLowerCase();
                    this.loadProducts(true);
                }, 500);
            });
        }

        const filterForm = document.getElementById('filterForm');
        if (filterForm) {
            filterForm.addEventListener('change', () => {
                this.updateFiltersFromUI();
                this.loadProducts(true);
            });
        }

        // Load More Pagination
        const loadMoreBtn = document.getElementById('btnLoadMoreProducts');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => this.loadProducts(false));
        }

        // Listing Creation
        const createForm = document.getElementById('formCreateListing');
        if (createForm) {
            createForm.addEventListener('submit', (e) => this.handleCreateListing(e));
        }
    }

    async loadMarketplace() {
        this.uiManager.showSkeletons();
        
        // Concurrent initial loads
        await Promise.allSettled([
            this.loadCategories(),
            this.loadProducts(true)
        ]);
        
        this.uiManager.hideSkeletons();
    }

    /**
     * Constructs the Firestore query based on current UI filters
     */
    buildQuery() {
        let qRef = collection(db, 'products');
        let constraints = [
            where('status', '==', 'active')
        ];

        // MVP Text Search using array-contains
        if (this.currentFilters.searchTerm) {
            constraints.push(where('searchTerms', 'array-contains', this.currentFilters.searchTerm));
        }

        // Category Filter
        if (this.currentFilters.category && this.currentFilters.category !== 'all') {
            constraints.push(where('category', '==', this.currentFilters.category));
        }

        // Price Filters
        if (this.currentFilters.minPrice) {
            constraints.push(where('price', '>=', this.currentFilters.minPrice));
        }
        if (this.currentFilters.maxPrice) {
            constraints.push(where('price', '<=', this.currentFilters.maxPrice));
        }

        // Sorting
        switch (this.currentFilters.sort) {
            case 'price_asc': constraints.push(orderBy('price', 'asc')); break;
            case 'price_desc': constraints.push(orderBy('price', 'desc')); break;
            case 'newest': 
            default: constraints.push(orderBy('createdAt', 'desc')); break;
        }

        // Pagination Limit
        constraints.push(limit(this.PAGE_SIZE));

        // Append Pagination Cursor
        if (this.lastVisibleDoc) {
            constraints.push(startAfter(this.lastVisibleDoc));
        }

        return query(qRef, ...constraints);
    }

    /**
     * Fetches products based on filters and pagination
     * @param {boolean} resetPagination True if filters changed, False for "Load More"
     */
    async loadProducts(resetPagination = false) {
        if (resetPagination) {
            this.lastVisibleDoc = null;
            this.uiManager.clearProductGrid();
        }

        try {
            this.uiManager.setLoading('btnLoadMoreProducts', true);
            
            const q = this.buildQuery();
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
                this.uiManager.renderProducts(snapshot);
            } else if (resetPagination) {
                this.uiManager.showEmptyState('No products match your criteria.');
            }

            this.uiManager.toggleLoadMore(snapshot.docs.length === this.PAGE_SIZE);

        } catch (error) {
            this.handleErrors('Load Products', error);
        } finally {
            this.uiManager.setLoading('btnLoadMoreProducts', false);
        }
    }

    /**
     * Handles UI submission for new listings, enforces verification rules
     * @param {Event} e 
     */
    async handleCreateListing(e) {
        e.preventDefault();
        if (this.isProcessing) return;

        const payload = this.uiManager.getListingPayload();
        
        if (!this.validateListing(payload)) return;

        // --- BUSINESS RULE: Unverified Seller Price Cap ---
        const UNVERIFIED_LIMIT = 20000;
        if (CurrentUser.verificationStatus !== 'verified' && payload.price > UNVERIFIED_LIMIT) {
            this.uiManager.showError(`Verify your account to list products above ${this.formatCurrency(UNVERIFIED_LIMIT)}.`);
            return;
        }

        this.isProcessing = true;
        this.uiManager.setLoading('btnSubmitListing', true);

        try {
            await this.createListing(payload);
            this.uiManager.showSuccess('Product listed successfully!');
            this.uiManager.resetCreateForm();
            this.loadProducts(true); // Refresh feed
        } catch (error) {
            this.handleErrors('Create Listing', error);
        } finally {
            this.isProcessing = false;
            this.uiManager.setLoading('btnSubmitListing', false);
        }
    }

    /**
     * Writes the new listing to Firestore
     * @param {Object} payload 
     */
    async createListing(payload) {
        const prodRef = doc(collection(db, 'products'));
        
        // Generate MVP Search Terms (Tokenize title)
        const searchTerms = payload.title.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        searchTerms.push(payload.category.toLowerCase());

        const productData = {
            productId: prodRef.id,
            title: payload.title,
            description: payload.description,
            category: payload.category,
            price: parseFloat(payload.price),
            currency: 'NGN',
            quantity: parseInt(payload.quantity),
            condition: payload.condition,
            location: payload.location,
            imageUrls: payload.imageUrls || [], // MVP: URLs inputted manually or via basic uploader
            searchTerms: searchTerms,
            
            // Seller Denormalization (For faster reads)
            sellerId: CurrentUser.uid,
            sellerUsername: CurrentUser.username,
            sellerVerification: CurrentUser.verificationStatus,
            sellerRating: CurrentUser.rating || 0,
            
            // System fields
            status: 'active',
            views: 0,
            favoritesCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(prodRef, productData);
        await this.logAudit('LISTING_CREATED', prodRef.id);
    }

    /**
     * Updates an existing listing ensuring ownership
     * @param {string} productId 
     * @param {Object} updatePayload 
     */
    async editListing(productId, updatePayload) {
        const prodRef = doc(db, 'products', productId);
        const prodDoc = await getDoc(prodRef);

        if (!prodDoc.exists()) throw new Error("Product not found.");
        if (prodDoc.data().sellerId !== CurrentUser.uid) throw { custom: true, message: "Unauthorized: You do not own this listing." };

        // Re-enforce Verification Rule on Edit
        const UNVERIFIED_LIMIT = 20000;
        const newPrice = updatePayload.price ? parseFloat(updatePayload.price) : prodDoc.data().price;
        if (CurrentUser.verificationStatus !== 'verified' && newPrice > UNVERIFIED_LIMIT) {
            throw { custom: true, message: `Verify your account to list products above ${this.formatCurrency(UNVERIFIED_LIMIT)}.` };
        }

        updatePayload.updatedAt = serverTimestamp();
        await updateDoc(prodRef, updatePayload);
        await this.logAudit('LISTING_UPDATED', productId);
    }

    /**
     * Soft deletes or completely deletes a listing
     * @param {string} productId 
     */
    async deleteListing(productId) {
        if (!confirm("Are you sure you want to delete this listing?")) return;

        try {
            const prodRef = doc(db, 'products', productId);
            const prodDoc = await getDoc(prodRef);

            if (!prodDoc.exists()) return;
            if (prodDoc.data().sellerId !== CurrentUser.uid) throw { custom: true, message: "Unauthorized deletion attempt." };

            // Soft delete by updating status
            await updateDoc(prodRef, { status: 'archived', updatedAt: serverTimestamp() });
            await this.logAudit('LISTING_DELETED', productId);
            
            this.uiManager.removeProductCard(productId);
            this.uiManager.showSuccess('Listing removed successfully.');

        } catch (error) {
            this.handleErrors('Delete Listing', error);
        }
    }

    /**
     * Hands off purchasing intent to the Escrow architecture
     * @param {string} productId 
     */
    async buyNow(productId) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const prodRef = doc(db, 'products', productId);
            const prodDoc = await getDoc(prodRef);

            if (!prodDoc.exists()) throw { custom: true, message: "Product no longer exists." };
            
            const product = prodDoc.data();

            if (product.status !== 'active' || product.quantity < 1) {
                throw { custom: true, message: "This product is currently out of stock or unavailable." };
            }

            if (product.sellerId === CurrentUser.uid) {
                throw { custom: true, message: "You cannot purchase your own listing." };
            }

            // Secure Handoff: Redirect to Escrow initialization with product context.
            // The escrow.js controller will handle the actual atomic fund locking.
            window.location.href = `/escrow-init.html?product=${productId}&seller=${product.sellerId}`;

        } catch (error) {
            this.handleErrors('Buy Now', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Toggles product in user's personal favorites subcollection
     * @param {string} productId 
     */
    async toggleFavorite(productId) {
        const favRef = doc(db, 'users', CurrentUser.uid, 'favorites', productId);
        
        try {
            const favDoc = await getDoc(favRef);
            if (favDoc.exists()) {
                await deleteDoc(favRef);
                this.uiManager.updateFavoriteIcon(productId, false);
            } else {
                await setDoc(favRef, {
                    productId: productId,
                    addedAt: serverTimestamp()
                });
                this.uiManager.updateFavoriteIcon(productId, true);
                
                // Fire and forget notification
                addDoc(collection(db, 'notifications'), {
                    uid: CurrentUser.uid,
                    message: "Item saved to your favorites.",
                    read: false,
                    createdAt: serverTimestamp()
                }).catch(()=>console.warn("Notification failed to send."));
            }
        } catch (error) {
            this.handleErrors('Favorite', error);
        }
    }

    /**
     * Validates input rules
     * @param {Object} payload 
     * @returns {boolean}
     */
    validateListing(payload) {
        if (!payload.title || payload.title.length < 5 || payload.title.length > 120) {
            this.uiManager.showError("Title must be between 5 and 120 characters.");
            return false;
        }
        if (!payload.description || payload.description.length < 30) {
            this.uiManager.showError("Description must be at least 30 characters.");
            return false;
        }
        if (isNaN(payload.price) || payload.price <= 0) {
            this.uiManager.showError("Price must be a valid positive number.");
            return false;
        }
        if (!payload.category) {
            this.uiManager.showError("Please select a category.");
            return false;
        }
        if (isNaN(payload.quantity) || payload.quantity < 1) {
            this.uiManager.showError("Quantity must be at least 1.");
            return false;
        }
        return true;
    }

    /**
     * Updates internal filter state from DOM elements
     */
    updateFiltersFromUI() {
        this.currentFilters.category = document.getElementById('filterCategory')?.value || null;
        this.currentFilters.minPrice = parseFloat(document.getElementById('filterMinPrice')?.value) || null;
        this.currentFilters.maxPrice = parseFloat(document.getElementById('filterMaxPrice')?.value) || null;
        this.currentFilters.sort = document.getElementById('filterSort')?.value || 'newest';
    }

    async loadCategories() {
        // MVP: Hardcoded scalable array. Future: Read from 'productCategories' collection.
        const categories = ['Electronics', 'Fashion', 'Phones', 'Computers', 'Vehicles', 'Real Estate', 'Services', 'Furniture'];
        this.uiManager.renderCategories(categories);
    }

    async logAudit(action, productId) {
        await addDoc(collection(db, 'auditLogs'), {
            uid: CurrentUser.uid,
            action: action,
            productId: productId,
            timestamp: serverTimestamp()
        });
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
    }

    handleErrors(context, error) {
        console.error(`[MetaEscrow Marketplace] ${context} Error:`, error);
        const msg = error.custom ? error.message : "An unexpected error occurred. Please try again.";
        this.uiManager.showError(msg);
    }

    /**
     * Abstracts DOM manipulation
     */
    get uiManager() {
        return {
            getListingPayload: () => ({
                title: document.getElementById('listTitle')?.value.trim(),
                description: document.getElementById('listDesc')?.value.trim(),
                price: document.getElementById('listPrice')?.value,
                category: document.getElementById('listCategory')?.value,
                quantity: document.getElementById('listQty')?.value,
                condition: document.getElementById('listCondition')?.value,
                location: document.getElementById('listLocation')?.value,
                imageUrls: [document.getElementById('listImage')?.value].filter(Boolean)
            }),
            renderProducts: (snapshot) => {
                const container = document.getElementById('marketplaceContainer');
                if (!container) return;

                const fragment = document.createDocumentFragment();
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    
                    // XSS Safe Element Creation
                    const card = document.createElement('div');
                    card.className = 'product-card bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col transition-shadow hover:shadow-md';
                    card.id = `prod_${data.productId}`;

                    const imgWrapper = document.createElement('div');
                    imgWrapper.className = 'aspect-w-1 aspect-h-1 w-full overflow-hidden rounded-md bg-gray-200 lg:aspect-none lg:h-48 relative';
                    
                    if (data.imageUrls && data.imageUrls.length > 0) {
                        const img = document.createElement('img');
                        img.src = data.imageUrls[0]; // Vulnerability mitigated by valid URL checks server-side
                        img.className = 'h-full w-full object-cover object-center lg:h-full lg:w-full';
                        imgWrapper.appendChild(img);
                    }
                    
                    // Verification Badge Logic
                    const badgeStr = data.sellerVerification === 'verified' 
                        ? `<span class="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full flex items-center shadow"><svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M6.267 3.4553c1.264-1.265 3.328-1.265 4.593 0L12 4.582l1.14-.127c1.785-.2 3.42 1.09 3.738 2.855l.235 1.306 1.155.65c1.554.872 2.11 2.83.1 4.143l-1.025.666-.34 1.28c-.46 1.734-2.296 2.766-4.103 2.308l-1.33-.338-1.01 1.01c-1.265 1.264-3.328 1.264-4.593 0L4.858 17.2l-1.14.126c-1.786.198-3.42-1.09-3.738-2.854l-.235-1.306-1.155-.65c-1.554-.872-2.11-2.83-.1-4.143l1.025-.666.34-1.28c.46-1.734 2.296-2.766 4.103-2.308l1.33.338 1.01-1.01zM14.293 8.293a1 1 0 00-1.414 0L10 11.172 8.121 9.293a1 1 0 00-1.414 1.414l2.586 2.586a1 1 0 001.414 0l3.586-3.586a1 1 0 000-1.414z"></path></svg> Verified</span>` 
                        : '';
                    imgWrapper.innerHTML += badgeStr;

                    const info = document.createElement('div');
                    info.className = 'mt-4 flex justify-between flex-1 flex-col';
                    
                    const title = document.createElement('h3');
                    title.className = 'text-sm text-gray-700 font-medium truncate';
                    title.textContent = data.title;
                    
                    const price = document.createElement('p');
                    price.className = 'text-lg font-bold text-gray-900 mt-1';
                    price.textContent = this.formatCurrency(data.price);
                    
                    const actions = document.createElement('div');
                    actions.className = 'mt-4 flex gap-2';
                    
                    if (data.sellerId !== CurrentUser.uid) {
                        const btnBuy = document.createElement('button');
                        btnBuy.className = 'flex-1 bg-green-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-green-700 transition';
                        btnBuy.textContent = 'Buy with Escrow';
                        btnBuy.dataset.action = 'buy';
                        btnBuy.dataset.id = data.productId;
                        actions.appendChild(btnBuy);
                    } else {
                        const btnManage = document.createElement('button');
                        btnManage.className = 'flex-1 bg-gray-100 text-gray-700 border px-3 py-2 rounded text-sm font-medium';
                        btnManage.textContent = 'Manage Listing';
                        btnManage.dataset.action = 'edit';
                        btnManage.dataset.id = data.productId;
                        actions.appendChild(btnManage);
                    }

                    info.appendChild(title);
                    info.appendChild(price);
                    info.appendChild(actions);
                    
                    card.appendChild(imgWrapper);
                    card.appendChild(info);
                    fragment.appendChild(card);
                });

                container.appendChild(fragment);
            },
            renderCategories: (cats) => {
                const select = document.getElementById('filterCategory');
                const listSelect = document.getElementById('listCategory');
                
                cats.forEach(c => {
                    if (select) select.appendChild(new Option(c, c));
                    if (listSelect) listSelect.appendChild(new Option(c, c));
                });
            },
            clearProductGrid: () => {
                const container = document.getElementById('marketplaceContainer');
                if (container) container.innerHTML = '';
            },
            removeProductCard: (id) => {
                const card = document.getElementById(`prod_${id}`);
                if (card) card.remove();
            },
            updateFavoriteIcon: (id, isFav) => {
                // DOM logic to toggle filled/empty heart icon state based on id
            },
            showEmptyState: (msg) => {
                const container = document.getElementById('marketplaceContainer');
                if (container) container.innerHTML = `<div class="col-span-full py-12 text-center text-gray-500">${msg}</div>`;
            },
            setLoading: (btnId, isLoading) => {
                const btn = document.getElementById(btnId);
                if (btn) btn.disabled = isLoading;
            },
            toggleLoadMore: (show) => {
                const btn = document.getElementById('btnLoadMoreProducts');
                if (btn) btn.style.display = show ? 'block' : 'none';
            },
            showSkeletons: () => {}, // Implement skeleton toggle logic
            hideSkeletons: () => {},
            resetCreateForm: () => document.getElementById('formCreateListing')?.reset(),
            showSuccess: (msg) => alert(`Success: ${msg}`),
            showError: (msg) => alert(`Error: ${msg}`)
        };
    }
}

export const marketplaceController = new MarketplaceController();

