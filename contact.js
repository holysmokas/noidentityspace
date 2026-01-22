// contact.js - Secure contact form handler for NoIdentity.Space

import { APPS_SCRIPT_URL } from './config.js';
import {
    initFormSecurity,
    validateFormSecurity,
    recordSubmission,
    prepareSecureFormData,
    generateAbuseFingerprint
} from './form-security.js';

const FORM_ID = 'contactForm';
const MAX_RETRIES = 3;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById(FORM_ID);
    const submitBtn = document.getElementById('submitBtn');
    const responseMessage = document.getElementById('responseMessage');

    if (!form || !submitBtn || !responseMessage) {
        console.error("Contact form elements not found. Check contact.html for IDs.");
        return;
    }

    // Initialize security tracking for this form
    initFormSecurity(FORM_ID);

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        // Configuration check
        if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_URL_HERE" || !APPS_SCRIPT_URL.includes('script.google.com')) {
            handleError("Configuration Error: The Apps Script URL has not been set correctly in config.js.");
            return;
        }

        // ========== SECURITY VALIDATION ==========
        const securityCheck = validateFormSecurity(form, FORM_ID);

        if (!securityCheck.valid) {
            // Special case: bot detected via honeypot - show fake success
            if (securityCheck.error === '__SILENT_FAIL__') {
                handleFakeSuccess();
                return;
            }

            // Show error for rate limiting, time gate, or input issues
            handleError(securityCheck.error);
            return;
        }
        // ==========================================

        // --- Start Submission State ---
        responseMessage.style.display = 'none';
        responseMessage.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        // Prepare sanitized form data
        const params = prepareSecureFormData(form);
        params.append('formType', 'contact');
        params.append('_fingerprint', generateAbuseFingerprint());

        // --- Fetch Request with Retry Logic ---
        let retries = 0;

        const attemptSubmission = () => {
            fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: params
            })
                .then(response => response.text())
                .then(text => {
                    if (text === 'success') {
                        recordSubmission(); // Track for rate limiting
                        handleSuccess();
                    } else {
                        throw new Error(`Form submission failed. Response: ${text}`);
                    }
                })
                .catch(error => {
                    if (retries < MAX_RETRIES) {
                        retries++;
                        const delay = Math.pow(2, retries) * 1000;
                        setTimeout(attemptSubmission, delay);
                    } else {
                        console.error('Submission Error:', error);
                        handleError("We couldn't send your message. Please verify your internet connection and try again.");
                    }
                })
                .finally(() => {
                    if (retries >= MAX_RETRIES) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Send Message';
                    }
                });
        };

        attemptSubmission();
    });

    /**
     * Handles successful submission
     */
    function handleSuccess() {
        responseMessage.className = 'message-box message-success';
        responseMessage.innerHTML = '<strong>Success!</strong> Your message has been sent. We will get back to you soon.';
        responseMessage.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
        form.reset();

        // Re-initialize security after reset (new form load time)
        initFormSecurity(FORM_ID);
    }

    /**
     * Fake success for honeypot-caught bots (don't alert them)
     */
    function handleFakeSuccess() {
        responseMessage.className = 'message-box message-success';
        responseMessage.innerHTML = '<strong>Success!</strong> Your message has been sent. We will get back to you soon.';
        responseMessage.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
        form.reset();

        // Log for monitoring (in production, you might send this to analytics)
        console.log('[Security] Bot submission blocked silently');
    }

    /**
     * Handles submission errors
     * @param {string} message - Error message to display
     */
    function handleError(message) {
        responseMessage.className = 'message-box message-error';
        responseMessage.innerHTML = `<strong>Error!</strong> ${message}`;
        responseMessage.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
    }
});