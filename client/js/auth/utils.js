/**
 * @fileoverview Enterprise Utility Library for MetaEscrow
 * @description Provides reusable, stateless helper functions for formatting, validation, storage, and async control.
 * @version 1.0.0
 */

// =========================================================
// CURRENCY & NUMBER HELPERS
// =========================================================

/**
 * Formats a number to standard currency string
 * @param {number} amount 
 * @param {string} currencyCode Default 'NGN'
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currencyCode = 'NGN') => {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2
    }).format(value);
};

/**
 * Converts Naira to Kobo (Base unit for DB storage)
 * @param {number} naira 
 * @returns {number}
 */
export const nairaToKobo = (naira) => Math.round(Number(naira) * 100);

/**
 * Converts Kobo to Naira (For UI display)
 * @param {number} kobo 
 * @returns {number}
 */
export const koboToNaira = (kobo) => Number(kobo) / 100;

export const formatNumber = (num) => new Intl.NumberFormat('en-NG').format(num);
export const roundNumber = (num, decimals = 2) => Number(Math.round(num + 'e' + decimals) + 'e-' + decimals);
export const calculatePercentage = (part, total) => total === 0 ? 0 : roundNumber((part / total) * 100);

// =========================================================
// DATE HELPERS
// =========================================================

export const formatDate = (dateInput) => {
    const date = new Date(dateInput);
    return new Intl.DateTimeFormat('en-NG', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
};

export const formatTime = (dateInput) => {
    const date = new Date(dateInput);
    return new Intl.DateTimeFormat('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
};

export const formatDateTime = (dateInput) => `${formatDate(dateInput)} at ${formatTime(dateInput)}`;

/**
 * Generates relative time strings (e.g., "2 hours ago")
 * @param {Date|number|string} dateInput 
 * @returns {string}
 */
export const relativeTime = (dateInput) => {
    const timeMs = typeof dateInput === 'number' ? dateInput : new Date(dateInput).getTime();
    const deltaSeconds = Math.round((timeMs - Date.now()) / 1000);
    const cutoffs = [60, 3600, 86400, 86400 * 7, 86400 * 30, 86400 * 365, Infinity];
    const units = ["second", "minute", "hour", "day", "week", "month", "year"];
    
    const unitIndex = cutoffs.findIndex(cutoff => cutoff > Math.abs(deltaSeconds));
    const divisor = unitIndex ? cutoffs[unitIndex - 1] : 1;
    
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    return rtf.format(Math.floor(deltaSeconds / divisor), units[unitIndex]);
};

// =========================================================
// VALIDATION & SANITIZATION HELPERS
// =========================================================

export const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
export const validatePhone = (phone) => /^(\+234|0)[789][01]\d{8}$/.test(String(phone));
export const validatePassword = (password) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/.test(password);
export const validateAmount = (amount) => !isNaN(amount) && Number(amount) > 0;
export const validateURL = (url) => /^https?:\/\/.+\..+/.test(String(url));

/**
 * Prevents XSS by escaping HTML entities
 * @param {string} str 
 * @returns {string}
 */
export const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Completely strips HTML tags from input
 * @param {string} str 
 * @returns {string}
 */
export const sanitizeInput = (str) => {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
};

// =========================================================
// TEXT HELPERS
// =========================================================

export const capitalize = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
export const titleCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
export const slugify = (str) => str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
export const truncate = (str, length = 50) => str?.length > length ? `${str.substring(0, length)}...` : str;

export const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy: ', err);
        return false;
    }
};

// =========================================================
// ID & RANDOM HELPERS
// =========================================================

export const generateUUID = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
});

export const generateRandomString = (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint32Array(length)))
        .map(x => chars[x % chars.length])
        .join('');
};

// =========================================================
// ARRAY & OBJECT HELPERS
// =========================================================

export const uniqueArray = (arr) => [...new Set(arr)];
export const paginate = (array, pageSize, pageNumber) => array.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);

export const groupBy = (array, key) => array.reduce((result, currentValue) => {
    (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
    return result;
}, {});

export const deepClone = (obj) => typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
export const mergeObjects = (target, source) => ({ ...target, ...source });

// =========================================================
// ASYNC, PERFORMANCE & NETWORK HELPERS
// =========================================================

export const debounce = (func, delay = 300) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
};

export const throttle = (func, limit = 300) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

export const memoize = (fn) => {
    const cache = new Map();
    return (...args) => {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key);
        const result = fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
};

export const retry = async (fn, retries = 3, delay = 1000) => {
    try {
        return await fn();
    } catch (err) {
        if (retries === 1) throw err;
        await new Promise(res => setTimeout(res, delay));
        return retry(fn, retries - 1, delay * 2);
    }
};

export const checkOnlineStatus = () => navigator.onLine;

// =========================================================
// STORAGE HELPERS
// =========================================================

class StorageHelper {
    constructor(storage) {
        this.storage = storage;
    }
    set(key, value) {
        try {
            this.storage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error('Storage quota exceeded', e);
        }
    }
    get(key) {
        try {
            const item = this.storage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            return this.storage.getItem(key); // Fallback to raw string if parsing fails
        }
    }
    remove(key) { this.storage.removeItem(key); }
    clear() { this.storage.clear(); }
}

export const localStore = new StorageHelper(localStorage);
export const sessionStore = new StorageHelper(sessionStorage);

// =========================================================
// UI HELPERS (DOM Agnostic Wrappers)
// =========================================================

export const showLoading = (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = true;
    btn.dataset.originalText = btn.innerText;
    btn.innerHTML = `<span class="animate-spin inline-block mr-2">↻</span> Processing...`;
};

export const hideLoading = (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = false;
    btn.innerText = btn.dataset.originalText || 'Submit';
};

export const Toast = {
    show: (message, type = 'info') => {
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 ${colors[type]} text-white px-6 py-3 rounded shadow-lg transition-opacity duration-300 z-50`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    success: (msg) => Toast.show(msg, 'success'),
    error: (msg) => Toast.show(msg, 'error'),
    warning: (msg) => Toast.show(msg, 'warning')
};

// =========================================================
// ERROR HELPERS
// =========================================================

export const parseFirebaseError = (error) => {
    const code = error.code || '';
    switch (code) {
        case 'auth/user-not-found': return 'Account not found. Please verify your email.';
        case 'auth/wrong-password': return 'Invalid email or password.';
        case 'auth/email-already-in-use': return 'This email is already registered.';
        case 'auth/network-request-failed': return 'Network error. Please check your internet connection.';
        case 'permission-denied': return 'You do not have permission to access this resource.';
        default: return error.custom ? error.message : 'An unexpected error occurred. Please try again.';
    }
};

