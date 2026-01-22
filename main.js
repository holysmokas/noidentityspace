// main.js - Central JavaScript entry point for NoIdentity.Space
// Includes secure newsletter form handling

import { APPS_SCRIPT_URL } from './config.js';
import {
    initFormSecurity,
    validateFormSecurity,
    recordSubmission,
    prepareSecureFormData,
    generateAbuseFingerprint
} from './form-security.js';

const MAX_RETRIES = 3;

// --- Global Functions ---

/**
 * Toggles the mobile navigation menu's visibility.
 */
window.toggleMenu = function () {
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
        navLinks.classList.toggle('active');
    }
}

// --- Newsletter Form Handling ---

/**
 * Handles secure newsletter form submission
 */
function handleNewsletterSubmission(e) {
    e.preventDefault();

    const form = e.target;
    const formId = form.id || 'newsletterForm';
    const submitBtn = form.querySelector('button[type="submit"]');

    // Get or create response message element
    let responseMessage = form.querySelector('.message-box');
    if (!responseMessage) {
        responseMessage = document.createElement('div');
        responseMessage.className = 'message-box';
        form.appendChild(responseMessage);
    }

    if (!submitBtn) {
        console.error("Newsletter submit button not found");
        return;
    }

    // Configuration check
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_URL_HERE" || !APPS_SCRIPT_URL.includes('script.google.com')) {
        showError(responseMessage, submitBtn, "Configuration Error: The Apps Script URL has not been set correctly.");
        return;
    }

    // ========== SECURITY VALIDATION ==========
    const securityCheck = validateFormSecurity(form, formId);

    if (!securityCheck.valid) {
        // Bot detected via honeypot - show fake success
        if (securityCheck.error === '__SILENT_FAIL__') {
            showFakeSuccess(responseMessage, submitBtn, form, formId);
            return;
        }

        // Show error for rate limiting, time gate, or input issues
        showError(responseMessage, submitBtn, securityCheck.error);
        return;
    }
    // ==========================================

    // --- Start Submission State ---
    responseMessage.style.display = 'none';
    responseMessage.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Subscribing...';

    // Prepare sanitized form data
    const params = prepareSecureFormData(form);
    params.append('formType', 'newsletter');
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
                    recordSubmission();
                    showSuccess(responseMessage, submitBtn, form, formId);
                } else {
                    throw new Error(`Subscription failed. Response: ${text}`);
                }
            })
            .catch(error => {
                if (retries < MAX_RETRIES) {
                    retries++;
                    const delay = Math.pow(2, retries) * 1000;
                    setTimeout(attemptSubmission, delay);
                } else {
                    console.error('Submission Error:', error);
                    showError(responseMessage, submitBtn, "We couldn't subscribe your email. Please try again later.");
                }
            });
    };

    attemptSubmission();
}

/**
 * Shows success message and resets form
 */
function showSuccess(messageElement, submitBtn, form, formId) {
    messageElement.className = 'message-box message-success';
    messageElement.innerHTML = '<strong>Success!</strong> You have been subscribed to our newsletter!';
    messageElement.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Subscribe';
    form.reset();

    // Re-initialize security after reset
    initFormSecurity(formId);
}

/**
 * Shows fake success for honeypot-caught bots
 */
function showFakeSuccess(messageElement, submitBtn, form, formId) {
    messageElement.className = 'message-box message-success';
    messageElement.innerHTML = '<strong>Success!</strong> You have been subscribed to our newsletter!';
    messageElement.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Subscribe';
    form.reset();

    console.log('[Security] Bot newsletter submission blocked silently');
}

/**
 * Shows error message
 */
function showError(messageElement, submitBtn, message) {
    messageElement.className = 'message-box message-error';
    messageElement.innerHTML = `<strong>Error!</strong> ${message}`;
    messageElement.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Subscribe';
}

/**
 * Sets up newsletter form with security
 */
function setupNewsletterForm() {
    // Main newsletter form (on index.html)
    const newsletterForm = document.getElementById('newsletterForm');
    if (newsletterForm) {
        initFormSecurity('newsletterForm');
        newsletterForm.addEventListener('submit', handleNewsletterSubmission);
        console.log('[Security] Main newsletter form initialized');
    }

    // Sidebar newsletter form (on article pages)
    const sidebarNewsletterForm = document.getElementById('sidebarNewsletterForm');
    if (sidebarNewsletterForm) {
        initFormSecurity('sidebarNewsletterForm');
        sidebarNewsletterForm.addEventListener('submit', handleNewsletterSubmission);
        console.log('[Security] Sidebar newsletter form initialized');
    }
}

/**
 * Main initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    // Setup smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
                // Close mobile menu if open
                const navLinks = document.getElementById('navLinks');
                if (navLinks) {
                    navLinks.classList.remove('active');
                }
            }
        });
    });

    // Setup newsletter forms with security
    setupNewsletterForm();
});