// form-security.js - Comprehensive form security module for NoIdentity.Space
// Protects against: bots, spam, XSS, injection attacks, and abuse

/**
 * Security Configuration
 */
const SECURITY_CONFIG = {
    // Time gate: minimum seconds before form can be submitted (bots submit instantly)
    MIN_SUBMISSION_TIME_MS: 3000,

    // Rate limiting: max submissions per window
    RATE_LIMIT_MAX: 3,
    RATE_LIMIT_WINDOW_MS: 60000, // 1 minute

    // Input constraints
    MAX_NAME_LENGTH: 100,
    MAX_EMAIL_LENGTH: 254,
    MAX_SUBJECT_LENGTH: 200,
    MAX_MESSAGE_LENGTH: 5000,

    // Honeypot field name (bots will fill this, humans won't see it)
    HONEYPOT_FIELD: 'website_url',

    // Storage keys for rate limiting
    STORAGE_KEY_SUBMISSIONS: 'nis_form_submissions',
    STORAGE_KEY_FORM_LOAD: 'nis_form_load_time'
};

/**
 * Tracks when forms are loaded for time-gate validation
 */
const formLoadTimes = new Map();

/**
 * Initialize security for a form - call this when page loads
 * @param {string} formId - The ID of the form element
 */
export function initFormSecurity(formId) {
    const timestamp = Date.now();
    formLoadTimes.set(formId, timestamp);

    // Also store in sessionStorage as backup (in case of SPA navigation)
    try {
        const loadTimes = JSON.parse(sessionStorage.getItem(SECURITY_CONFIG.STORAGE_KEY_FORM_LOAD) || '{}');
        loadTimes[formId] = timestamp;
        sessionStorage.setItem(SECURITY_CONFIG.STORAGE_KEY_FORM_LOAD, JSON.stringify(loadTimes));
    } catch (e) {
        // sessionStorage might be unavailable
    }

    console.log(`[Security] Form "${formId}" initialized at ${timestamp}`);
}

/**
 * Main validation function - run all security checks
 * @param {HTMLFormElement} form - The form element
 * @param {string} formId - The form identifier
 * @returns {Object} { valid: boolean, error: string|null }
 */
export function validateFormSecurity(form, formId) {
    // 1. Honeypot check (most important - catches most bots)
    const honeypotCheck = checkHoneypot(form);
    if (!honeypotCheck.valid) {
        console.warn('[Security] Honeypot triggered');
        return honeypotCheck;
    }

    // 2. Time gate check (bots submit too fast)
    const timeCheck = checkTimeGate(formId);
    if (!timeCheck.valid) {
        console.warn('[Security] Time gate triggered');
        return timeCheck;
    }

    // 3. Rate limiting check
    const rateCheck = checkRateLimit();
    if (!rateCheck.valid) {
        console.warn('[Security] Rate limit triggered');
        return rateCheck;
    }

    // 4. Input sanitization and validation
    const inputCheck = validateAndSanitizeInputs(form);
    if (!inputCheck.valid) {
        console.warn('[Security] Input validation failed:', inputCheck.error);
        return inputCheck;
    }

    // 5. Spam content detection
    const spamCheck = detectSpamContent(form);
    if (!spamCheck.valid) {
        console.warn('[Security] Spam content detected');
        return spamCheck;
    }

    return { valid: true, error: null };
}

/**
 * Check if honeypot field was filled (indicates bot)
 */
function checkHoneypot(form) {
    const honeypotField = form.querySelector(`[name="${SECURITY_CONFIG.HONEYPOT_FIELD}"]`);

    if (honeypotField && honeypotField.value.trim() !== '') {
        // Bot detected - return fake success to not alert the attacker
        return {
            valid: false,
            error: '__SILENT_FAIL__', // Special flag to show fake success
            isBot: true
        };
    }

    return { valid: true, error: null };
}

/**
 * Check if enough time has passed since form load
 */
function checkTimeGate(formId) {
    let loadTime = formLoadTimes.get(formId);

    // Try sessionStorage as backup
    if (!loadTime) {
        try {
            const loadTimes = JSON.parse(sessionStorage.getItem(SECURITY_CONFIG.STORAGE_KEY_FORM_LOAD) || '{}');
            loadTime = loadTimes[formId];
        } catch (e) {
            // Fallback: if we can't determine load time, allow submission
            return { valid: true, error: null };
        }
    }

    if (!loadTime) {
        // If still no load time, allow but log
        console.warn('[Security] No load time found for form, allowing submission');
        return { valid: true, error: null };
    }

    const elapsed = Date.now() - loadTime;

    if (elapsed < SECURITY_CONFIG.MIN_SUBMISSION_TIME_MS) {
        return {
            valid: false,
            error: 'Please take a moment to fill out the form completely.',
            isBot: true // Likely a bot
        };
    }

    return { valid: true, error: null };
}

/**
 * Check rate limiting using localStorage
 */
function checkRateLimit() {
    try {
        const now = Date.now();
        let submissions = JSON.parse(localStorage.getItem(SECURITY_CONFIG.STORAGE_KEY_SUBMISSIONS) || '[]');

        // Filter to only submissions within the window
        submissions = submissions.filter(time =>
            now - time < SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS
        );

        if (submissions.length >= SECURITY_CONFIG.RATE_LIMIT_MAX) {
            const oldestSubmission = Math.min(...submissions);
            const waitTime = Math.ceil((SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS - (now - oldestSubmission)) / 1000);

            return {
                valid: false,
                error: `Too many submissions. Please wait ${waitTime} seconds before trying again.`
            };
        }

        return { valid: true, error: null };
    } catch (e) {
        // localStorage unavailable, allow submission
        return { valid: true, error: null };
    }
}

/**
 * Record a successful submission for rate limiting
 */
export function recordSubmission() {
    try {
        const now = Date.now();
        let submissions = JSON.parse(localStorage.getItem(SECURITY_CONFIG.STORAGE_KEY_SUBMISSIONS) || '[]');

        // Clean old entries and add new one
        submissions = submissions.filter(time =>
            now - time < SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS
        );
        submissions.push(now);

        localStorage.setItem(SECURITY_CONFIG.STORAGE_KEY_SUBMISSIONS, JSON.stringify(submissions));
    } catch (e) {
        // localStorage unavailable
    }
}

/**
 * Validate and sanitize all form inputs
 */
function validateAndSanitizeInputs(form) {
    const formData = new FormData(form);

    for (const [key, value] of formData.entries()) {
        // Skip honeypot field
        if (key === SECURITY_CONFIG.HONEYPOT_FIELD) continue;

        // Skip non-string values (files, etc.)
        if (typeof value !== 'string') continue;

        // Check for maximum lengths
        const maxLengths = {
            name: SECURITY_CONFIG.MAX_NAME_LENGTH,
            email: SECURITY_CONFIG.MAX_EMAIL_LENGTH,
            subject: SECURITY_CONFIG.MAX_SUBJECT_LENGTH,
            message: SECURITY_CONFIG.MAX_MESSAGE_LENGTH
        };

        if (maxLengths[key] && value.length > maxLengths[key]) {
            return {
                valid: false,
                error: `${key.charAt(0).toUpperCase() + key.slice(1)} is too long. Maximum ${maxLengths[key]} characters.`
            };
        }

        // Check for suspicious patterns (potential XSS/injection)
        if (containsSuspiciousContent(value)) {
            return {
                valid: false,
                error: 'Your message contains invalid characters. Please remove any code or special formatting.'
            };
        }
    }

    // Validate email format
    const email = formData.get('email');
    if (email && !isValidEmail(email)) {
        return { valid: false, error: 'Please enter a valid email address.' };
    }

    return { valid: true, error: null };
}

/**
 * Check for XSS and injection patterns
 */
function containsSuspiciousContent(value) {
    const suspiciousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,  // Script tags
        /javascript:/gi,                                         // JavaScript protocol
        /on\w+\s*=/gi,                                          // Event handlers (onclick=, etc.)
        /<iframe/gi,                                            // iframes
        /<object/gi,                                            // Object tags
        /<embed/gi,                                             // Embed tags
        /<link/gi,                                              // Link tags (can load external resources)
        /data:/gi,                                              // Data URIs
        /vbscript:/gi,                                          // VBScript protocol
        /expression\s*\(/gi,                                    // CSS expressions
        /url\s*\(\s*['"]?\s*data:/gi,                          // CSS data URIs
    ];

    return suspiciousPatterns.some(pattern => pattern.test(value));
}

/**
 * Detect if a string is gibberish (random characters, likely bot-generated)
 * Checks vowel ratio, consonant clusters, and entropy
 */
function isGibberish(text) {
    if (!text || text.length < 6) return false;

    // Clean the text - remove spaces and numbers for analysis
    const cleaned = text.replace(/[\s\d]/g, '').toLowerCase();
    if (cleaned.length < 6) return false;

    // 1. Vowel ratio check - natural language has ~35-45% vowels
    const vowels = (cleaned.match(/[aeiou]/g) || []).length;
    const vowelRatio = vowels / cleaned.length;

    // Too few vowels (like "teUxkdAfKqxsOc" = 4/14 = 28%) is suspicious
    // Too many vowels is also suspicious
    if (vowelRatio < 0.2 || vowelRatio > 0.7) {
        return true;
    }

    // 2. Consonant cluster check - natural language rarely has 5+ consonants in a row
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(cleaned)) {
        return true;
    }

    // 3. Mixed case pattern check - random strings often have erratic casing
    const originalCleaned = text.replace(/[\s\d]/g, '');
    if (originalCleaned.length >= 8) {
        let caseChanges = 0;
        for (let i = 1; i < originalCleaned.length; i++) {
            const prevUpper = originalCleaned[i - 1] === originalCleaned[i - 1].toUpperCase();
            const currUpper = originalCleaned[i] === originalCleaned[i].toUpperCase();
            if (prevUpper !== currUpper) caseChanges++;
        }
        // More than 50% case changes is suspicious (like "AsYmNaewgOP")
        if (caseChanges / originalCleaned.length > 0.5) {
            return true;
        }
    }

    // 4. Common letter pair check - gibberish lacks natural letter patterns
    const commonPairs = ['th', 'he', 'in', 'er', 'an', 'on', 'en', 'at', 'es', 'ed', 'or', 'ti', 'is', 'it', 'al', 'ar', 'st', 'to', 'nt', 'ng'];
    let pairMatches = 0;
    for (const pair of commonPairs) {
        if (cleaned.includes(pair)) pairMatches++;
    }
    // Natural text usually has at least 2-3 common pairs per 10 characters
    const expectedPairs = Math.floor(cleaned.length / 5);
    if (cleaned.length >= 10 && pairMatches < Math.min(expectedPairs, 2)) {
        return true;
    }

    return false;
}

/**
 * Detect spam content patterns
 */
function detectSpamContent(form) {
    const formData = new FormData(form);
    const name = formData.get('name') || '';
    const message = formData.get('message') || '';
    const subject = formData.get('subject') || '';
    const combinedText = `${subject} ${message}`.toLowerCase();

    // Spam indicators
    const spamPatterns = [
        // Gibberish name detection (catches bot-generated random strings)
        {
            test: () => isGibberish(name),
            reason: 'Please enter a valid name'
        },
        // Gibberish subject detection
        {
            test: () => subject && isGibberish(subject),
            reason: 'Please enter a valid subject'
        },
        // Gibberish message detection (only if message is short - long messages may have some gibberish legitimately)
        {
            test: () => message && message.length < 100 && isGibberish(message),
            reason: 'Please enter a valid message'
        },
        // Excessive URLs (more than 3)
        {
            test: () => (combinedText.match(/https?:\/\//g) || []).length > 3,
            reason: 'Too many links'
        },
        // Common spam phrases
        {
            test: () => /\b(viagra|casino|lottery|winner|nigerian prince|bitcoin investment|crypto doubler)\b/i.test(combinedText),
            reason: 'Spam content detected'
        },
        // All caps message (often spam)
        {
            test: () => message.length > 50 && message === message.toUpperCase(),
            reason: 'Please avoid using all capital letters'
        },
        // Repeated characters (spammy)
        {
            test: () => /(.)\1{10,}/g.test(combinedText),
            reason: 'Invalid content detected'
        }
    ];

    for (const pattern of spamPatterns) {
        if (pattern.test()) {
            return { valid: false, error: pattern.reason };
        }
    }

    return { valid: true, error: null };
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    // RFC 5322 compliant regex (simplified)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email) && email.length <= SECURITY_CONFIG.MAX_EMAIL_LENGTH;
}

/**
 * Sanitize a string for safe storage/display
 * @param {string} input - The input string
 * @returns {string} Sanitized string
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') return input;

    return input
        // Remove null bytes
        .replace(/\0/g, '')
        // Encode HTML entities
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        // Remove control characters (except newlines and tabs)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Trim excessive whitespace
        .trim();
}

/**
 * Prepare form data for submission with sanitization
 * @param {HTMLFormElement} form - The form element
 * @returns {URLSearchParams} Sanitized form data
 */
export function prepareSecureFormData(form) {
    const formData = new FormData(form);
    const sanitizedData = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
        // Skip honeypot field in actual submission
        if (key === SECURITY_CONFIG.HONEYPOT_FIELD) continue;

        if (typeof value === 'string') {
            sanitizedData.append(key, sanitizeInput(value));
        } else {
            sanitizedData.append(key, value);
        }
    }

    // Add security metadata for backend validation
    sanitizedData.append('_timestamp', Date.now().toString());
    sanitizedData.append('_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown');

    return sanitizedData;
}

/**
 * Generate a simple client fingerprint for abuse detection
 * This is NOT for tracking users, only for detecting repeated abuse
 */
export function generateAbuseFingerprint() {
    const components = [
        navigator.language,
        navigator.platform,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset()
    ];

    // Simple hash
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
}

// Export config for testing
export { SECURITY_CONFIG };