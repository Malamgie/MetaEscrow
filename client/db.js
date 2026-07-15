// db.js - MetaEscrow LocalStorage Database Service
// ACADEMIC PROTOTYPE ONLY: Security components (like passwords) are stored locally for presentation purposes. Do not use in production.

const DB_KEYS = {
    USERS: 'metaescrow_users',
    SESSION: 'metaescrow_session',
    TRANSACTIONS: 'metaescrow_transactions',
    WALLETS: 'metaescrow_wallets',
    NOTIFICATIONS: 'metaescrow_notifications',
    SETTINGS: 'metaescrow_settings'
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
            kyc: 'Verified',
            profilePhoto: 'Default avatar',
            createdAt: new Date().toISOString()
        };

        saveData(DB_KEYS.USERS, [admin, buyer, seller]);

        // 4. Sample Escrow Transaction
        const transaction = {
            id: generateId('TRX'),
            buyer: 'USR0001',
            seller: 'USR0002',
            title: 'MacBook Pro M2',
            description: 'Used MacBook Pro M2 256GB in pristine condition.',
            amount: 450000,
            fee: 4500,
            status: 'Pending',
            createdDate: new Date().toISOString(),
            updatedDate: new Date().toISOString(),
            paymentStatus: 'Unpaid',
            releaseStatus: 'Locked'
        };

        saveData(DB_KEYS.TRANSACTIONS, [transaction]);

        // 5. Sample Wallets
        saveData(DB_KEYS.WALLETS, [
            { userId: 'ADM0001', balance: 0, history: [] },
            { userId: 'USR0001', balance: 150000, history: [{ id: generateId('TXN'), type: 'Credit', amount: 150000, description: 'Initial Funding', date: new Date().toISOString() }] },
            { userId: 'USR0002', balance: 25000, history: [{ id: generateId('TXN'), type: 'Credit', amount: 25000, description: 'Initial Funding', date: new Date().toISOString() }] }
        ]);

        // 6. Sample Notifications
        saveData(DB_KEYS.NOTIFICATIONS, [
            { id: generateId('NOT'), userId: 'ADM0001', title: 'System Setup', message: 'Prototype architecture initialized securely.', date: new Date().toISOString(), read: false },
            { id: generateId('NOT'), userId: 'USR0001', title: 'Welcome', message: 'Your MetaEscrow account is ready.', date: new Date().toISOString(), read: false },
            { id: generateId('NOT'), userId: 'USR0002', title: 'Welcome', message: 'Your MetaEscrow account is ready.', date: new Date().toISOString(), read: false }
        ]);

        // 7. Core Settings
        saveData(DB_KEYS.SETTINGS, { platformFeePercent: 1.0 });

        console.log("MetaEscrow LocalStorage offline database initialized successfully.");
    }
}

// Automatically bootstrap database if empty on page load
initializeDatabase(); 
