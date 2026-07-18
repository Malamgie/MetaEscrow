// db.js - MetaEscrow LocalStorage Database Service
// ACADEMIC PROTOTYPE ONLY: Security components (like passwords) are stored locally for presentation purposes. Do not use in production.

const DB_KEYS = {
    USERS: 'metaescrow_users',
    SESSION: 'metaescrow_session',
    TRANSACTIONS: 'metaescrow_transactions',
    WALLETS: 'metaescrow_wallets',
    NOTIFICATIONS: 'metaescrow_notifications',
    SETTINGS: 'metaescrow_settings',
    MARKETPLACE: 'metaescrow_marketplace',
    SUPPORT: 'metaescrow_support',
    WALLET_REQUESTS: 'metaescrow_wallet_requests',
    PENDING_INIT: 'metaescrow_pending_init' // Used for frictionless landing page onboarding
};

// ==========================================
// CORE HELPERS
// ==========================================

function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function loadData(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
}

function updateData(key, id, newData) {
    const dataArray = loadData(key) || [];
    const index = dataArray.findIndex(item => item.id === id || item.userId === id);
    if (index !== -1) {
        dataArray[index] = { ...dataArray[index], ...newData };
        saveData(key, dataArray);
        return true;
    }
    return false;
}

function deleteData(key, id) {
    const dataArray = loadData(key) || [];
    const filtered = dataArray.filter(item => item.id !== id && item.userId !== id);
    saveData(key, filtered);
}

function generateId(prefix = 'ID') {
    const timestamp = Date.now().toString().slice(-4);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}${timestamp}${random}`;
}

// ==========================================
// AUTHENTICATION HELPERS
// ==========================================

function getCurrentUser() {
    return loadData(DB_KEYS.SESSION);
}

function setCurrentUser(user) {
    saveData(DB_KEYS.SESSION, user);
}

function logout() {
    localStorage.removeItem(DB_KEYS.SESSION);
    window.location.href = 'login.html';
}

// ==========================================
// PROTOTYPE FIRST RUN INITIALIZATION
// ==========================================

function initializeDatabase() {
    // If no users exist, it means localStorage is empty and we need to populate the demo data.
    if (!loadData(DB_KEYS.USERS)) {
        
        // 1. Default Admin Account
        const admin = {
            id: 'ADM0001',
            role: 'Admin',
            name: 'Aliyu Garba Musa',
            username: 'MetaGie',
            email: 'malamgiemou00@gmail.com',
            password: 'Aliyoux@1',
            status: 'Active',
            verified: true,
            walletBalance: 0,
            kyc: 'Verified',
            profilePhoto: 'Default avatar',
            createdAt: new Date().toISOString()
        };

        // 2. Sample Buyer
        const buyer = {
            id: 'USR0001',
            role: 'User',
            name: 'Maya John',
            username: 'Maya',
            email: 'buyer@demo.com',
            password: 'password123',
            status: 'Active',
            verified: true,
            walletBalance: 150000,
            kyc: 'Verified',
            profilePhoto: 'Default avatar',
            createdAt: new Date().toISOString()
        };

        // 3. Sample Seller
        const seller = {
            id: 'USR0002',
            role: 'User',
            name: 'Dalladi Tech',
            username: 'Dalladi',
            email: 'seller@demo.com',
            password: 'password123',
            status: 'Active',
            verified: true,
            walletBalance: 25000,
            kyc: 'Pending', // Set to pending to demonstrate KYC approval in Admin Panel
            profilePhoto: 'Default avatar',
            createdAt: new Date().toISOString()
        };

        saveData(DB_KEYS.USERS, [admin, buyer, seller]);

        // 4. Sample Escrow Transactions
        // Transaction 1: Pending (Needs Acceptance)
        const transaction1 = {
            id: generateId('TRX'),
            buyer: 'USR0001',
            seller: 'USR0002',
            initiator: 'USR0001', // Buyer initiated
            title: 'MacBook Pro M2',
            description: 'Used MacBook Pro M2 256GB in pristine condition.',
            category: 'electronics',
            amount: 450000,
            fee: 4500,
            status: 'Pending', // Waiting for seller acceptance
            createdDate: new Date().toISOString(),
            updatedDate: new Date().toISOString(),
            paymentStatus: 'Unpaid',
            releaseStatus: 'Locked',
            messages: [] // Built-in chat ledger
        };

        // Transaction 2: Disputed (With Chat History for Admin view)
        const transaction2 = {
            id: generateId('TRX'),
            buyer: 'USR0001',
            seller: 'USR0002',
            initiator: 'USR0002', // Seller initiated
            title: 'Freelance Web Development',
            description: 'E-commerce website development phase 1.',
            category: 'services',
            amount: 150000,
            fee: 1500,
            status: 'Disputed',
            disputeDetails: {
                raisedBy: 'buyer',
                reason: 'Item not delivered',
                date: new Date().toISOString()
            },
            createdDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            updatedDate: new Date().toISOString(),
            paymentStatus: 'Paid',
            releaseStatus: 'Locked',
            messages: [
                { id: generateId('MSG'), senderId: 'USR0002', text: 'Hi Maya, I have delivered the source code to your email.', timestamp: new Date(Date.now() - 5000000).toISOString(), isAdmin: false },
                { id: generateId('MSG'), senderId: 'USR0001', text: 'I received the files, but the payment gateway is completely broken. This is not what we agreed on.', timestamp: new Date(Date.now() - 4000000).toISOString(), isAdmin: false }
            ]
        };

        saveData(DB_KEYS.TRANSACTIONS, [transaction1, transaction2]);

        // 5. Sample Wallets (Adjusted to reflect the paid transaction above)
        saveData(DB_KEYS.WALLETS, [
            { userId: 'ADM0001', balance: 0, history: [] },
            { 
                userId: 'USR0001', 
                balance: 150000, 
                history: [
                    { id: generateId('TXN'), type: 'Credit', amount: 300000, description: 'Initial Funding', date: new Date(Date.now() - 100000000).toISOString() },
                    { id: generateId('TXN'), type: 'Debit', amount: 150000, description: `Escrow Payment (${transaction2.id})`, date: new Date(Date.now() - 86400000).toISOString() }
                ] 
            },
            { 
                userId: 'USR0002', 
                balance: 25000, 
                history: [
                    { id: generateId('TXN'), type: 'Credit', amount: 25000, description: 'Initial Funding', date: new Date().toISOString() }
                ] 
            }
        ]);

        // 6. Sample Wallet Requests (Pending manual approval)
        saveData(DB_KEYS.WALLET_REQUESTS, [
            { id: generateId('REQ'), userId: 'USR0001', type: 'Deposit', amount: 50000, method: 'Bank Transfer', proof: 'https://example.com/receipt.jpg', status: 'Pending', date: new Date().toISOString() },
            { id: generateId('REQ'), userId: 'USR0002', type: 'Withdrawal', amount: 10000, accountName: 'Dalladi Tech', bankName: 'Access Bank', accountNumber: '0123456789', status: 'Pending', date: new Date().toISOString() }
        ]);

        // 7. Sample Marketplace Listings
        saveData(DB_KEYS.MARKETPLACE, [
            { id: generateId('PRD'), sellerId: 'ADM0001', sellerName: 'MetaGie', title: 'Apple MacBook Pro 16" M2 Max', price: 2850000, category: 'electronics', location: 'lagos', rating: 4.9, sales: 124, img: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=500&q=80', condition: 'Like New', verified: true, status: 'Active', createdDate: new Date().toISOString() },
            { id: generateId('PRD'), sellerId: 'USR0001', sellerName: 'Maya John', title: 'Nike Air Max 2023 - Premium', price: 85000, category: 'fashion', location: 'abuja', rating: 4.5, sales: 12, img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=500&q=80', condition: 'Brand New', verified: true, status: 'Active', createdDate: new Date().toISOString() }
        ]);

        // 8. Sample Support Tickets
        saveData(DB_KEYS.SUPPORT, [
            { id: generateId('TKT'), userId: 'USR0001', subject: 'Need help releasing funds', category: 'Escrow', message: 'I have inspected the item and want to release funds but the button is grayed out.', status: 'Open', date: new Date().toISOString(), replies: [] }
        ]);

        // 9. Sample Notifications
        saveData(DB_KEYS.NOTIFICATIONS, [
            { id: generateId('NOT'), userId: 'ADM0001', title: 'System Setup', message: 'Prototype architecture initialized securely.', date: new Date().toISOString(), read: false },
            { id: generateId('NOT'), userId: 'USR0001', title: 'Welcome', message: 'Your MetaEscrow account is ready. Please complete KYC.', date: new Date().toISOString(), read: false },
            { id: generateId('NOT'), userId: 'USR0002', title: 'Welcome', message: 'Your MetaEscrow account is ready. Please complete KYC.', date: new Date().toISOString(), read: false }
        ]);

        // 10. Core Settings (Including Admin Bank Details)
        saveData(DB_KEYS.SETTINGS, { 
            platformFeePercent: 1.0,
            adminBankDetails: {
                accountNumber: '7086676866',
                accountName: 'Aliyu Garba Musa',
                bankName: 'OPAY'
            }
        });

        console.log("MetaEscrow LocalStorage offline database initialized successfully.");
    }
}

// Automatically bootstrap database if empty on page load
initializeDatabase();
