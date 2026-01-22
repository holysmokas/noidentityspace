#!/usr/bin/env node

/**
 * add-honeypot-to-articles.js
 * 
 * Batch script to inject honeypot security field into all existing article
 * newsletter forms in the NoIdentity.space articles directory.
 * 
 * Usage:
 *   node scripts/add-honeypot-to-articles.js
 * 
 * Or make executable and run directly:
 *   chmod +x scripts/add-honeypot-to-articles.js
 *   ./scripts/add-honeypot-to-articles.js
 * 
 * Options:
 *   --dry-run    Preview changes without modifying files
 *   --verbose    Show detailed output for each file
 * 
 * Date: January 22, 2026
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    // Path to articles directory (adjust if script is in different location)
    articlesDir: path.join(__dirname, '../articles'),

    // Backup original files before modifying
    createBackups: true,
    backupSuffix: '.backup',

    // The honeypot HTML to inject
    honeypotHTML: `
        <!-- HONEYPOT FIELD - Hidden from humans, bots will fill it -->
        <div style="opacity: 0; position: absolute; top: 0; left: 0; height: 0; width: 0; z-index: -1; overflow: hidden;" aria-hidden="true">
            <input type="text" name="website_url" tabindex="-1" autocomplete="off">
        </div>
        <!-- END HONEYPOT -->`,
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Stats tracking
const stats = {
    scanned: 0,
    modified: 0,
    alreadySecured: 0,
    noForm: 0,
    errors: 0,
    files: {
        modified: [],
        alreadySecured: [],
        noForm: [],
        errors: []
    }
};

/**
 * Main function
 */
async function main() {
    console.log('🔒 NoIdentity.space Article Security Patcher');
    console.log('============================================\n');

    if (DRY_RUN) {
        console.log('⚠️  DRY RUN MODE - No files will be modified\n');
    }

    // Check if articles directory exists
    if (!fs.existsSync(CONFIG.articlesDir)) {
        console.error(`❌ Articles directory not found: ${CONFIG.articlesDir}`);
        console.error('   Please run this script from your project root or update CONFIG.articlesDir');
        process.exit(1);
    }

    // Get all HTML files
    const files = fs.readdirSync(CONFIG.articlesDir)
        .filter(f => f.endsWith('.html') && !f.endsWith('.backup'));

    console.log(`📁 Found ${files.length} HTML files in ${CONFIG.articlesDir}\n`);

    if (files.length === 0) {
        console.log('No HTML files to process.');
        process.exit(0);
    }

    // Process each file
    for (const file of files) {
        await processFile(file);
    }

    // Print summary
    printSummary();
}

/**
 * Process a single article file
 */
async function processFile(filename) {
    const filepath = path.join(CONFIG.articlesDir, filename);
    stats.scanned++;

    try {
        // Read file content
        let content = fs.readFileSync(filepath, 'utf8');

        // Check if file has a sidebar newsletter form
        if (!hasSidebarNewsletterForm(content)) {
            stats.noForm++;
            stats.files.noForm.push(filename);
            if (VERBOSE) {
                console.log(`⏭️  ${filename} - No sidebar newsletter form found`);
            }
            return;
        }

        // Check if honeypot already exists
        if (hasHoneypot(content)) {
            stats.alreadySecured++;
            stats.files.alreadySecured.push(filename);
            if (VERBOSE) {
                console.log(`✅ ${filename} - Already has honeypot protection`);
            }
            return;
        }

        // Inject honeypot
        const updatedContent = injectHoneypot(content);

        if (!updatedContent) {
            stats.errors++;
            stats.files.errors.push({ file: filename, error: 'Failed to inject honeypot' });
            console.log(`❌ ${filename} - Failed to inject honeypot`);
            return;
        }

        if (DRY_RUN) {
            console.log(`🔍 ${filename} - Would add honeypot protection`);
            stats.modified++;
            stats.files.modified.push(filename);
            return;
        }

        // Create backup if enabled
        if (CONFIG.createBackups) {
            const backupPath = filepath + CONFIG.backupSuffix;
            fs.writeFileSync(backupPath, content, 'utf8');
        }

        // Write updated content
        fs.writeFileSync(filepath, updatedContent, 'utf8');

        stats.modified++;
        stats.files.modified.push(filename);
        console.log(`🔒 ${filename} - Honeypot protection added`);

    } catch (error) {
        stats.errors++;
        stats.files.errors.push({ file: filename, error: error.message });
        console.error(`❌ ${filename} - Error: ${error.message}`);
    }
}

/**
 * Check if content has a sidebar newsletter form
 */
function hasSidebarNewsletterForm(content) {
    // Look for the sidebar newsletter form by ID or class
    return content.includes('id="sidebarNewsletterForm"') ||
        content.includes('class="sidebar-newsletter-form"');
}

/**
 * Check if honeypot already exists in content
 */
function hasHoneypot(content) {
    // Check for honeypot field by name or comment
    return content.includes('name="website_url"') ||
        content.includes('HONEYPOT FIELD');
}

/**
 * Inject honeypot field into the sidebar newsletter form
 */
function injectHoneypot(content) {
    // Strategy 1: Find the email input and add honeypot after it
    // Pattern: <input type="email" ... for sidebar form

    // Look for the sidebar newsletter form section
    const formPatterns = [
        // Pattern 1: Find email input in sidebar form and add after it
        {
            find: /(<form[^>]*id="sidebarNewsletterForm"[^>]*>[\s\S]*?<input[^>]*type="email"[^>]*>)/i,
            replace: (match) => match + CONFIG.honeypotHTML
        },
        // Pattern 2: Alternative - find email input with name="email" in sidebar context
        {
            find: /(<input[^>]*name="email"[^>]*placeholder="Your email"[^>]*>)/i,
            replace: (match) => match + CONFIG.honeypotHTML
        },
        // Pattern 3: Find any email input followed by a submit button in sidebar
        {
            find: /(<input[^>]*type="email"[^>]*style="[^"]*width:\s*100%[^"]*"[^>]*>)/i,
            replace: (match) => match + CONFIG.honeypotHTML
        }
    ];

    for (const pattern of formPatterns) {
        if (pattern.find.test(content)) {
            return content.replace(pattern.find, pattern.replace);
        }
    }

    // Strategy 2: More aggressive - find the form and inject after first input
    const formMatch = content.match(/<form[^>]*sidebarNewsletterForm[^>]*>([\s\S]*?)<\/form>/i);
    if (formMatch) {
        const formContent = formMatch[0];
        const inputMatch = formContent.match(/<input[^>]*>/i);
        if (inputMatch) {
            const updatedForm = formContent.replace(inputMatch[0], inputMatch[0] + CONFIG.honeypotHTML);
            return content.replace(formMatch[0], updatedForm);
        }
    }

    return null;
}

/**
 * Print summary of operations
 */
function printSummary() {
    console.log('\n============================================');
    console.log('📊 SUMMARY');
    console.log('============================================\n');

    console.log(`Total files scanned:     ${stats.scanned}`);
    console.log(`Files modified:          ${stats.modified}`);
    console.log(`Already secured:         ${stats.alreadySecured}`);
    console.log(`No newsletter form:      ${stats.noForm}`);
    console.log(`Errors:                  ${stats.errors}`);

    if (stats.files.modified.length > 0) {
        console.log(`\n✅ Modified files:`);
        stats.files.modified.forEach(f => console.log(`   - ${f}`));
    }

    if (stats.files.errors.length > 0) {
        console.log(`\n❌ Errors:`);
        stats.files.errors.forEach(e => console.log(`   - ${e.file}: ${e.error}`));
    }

    if (DRY_RUN && stats.modified > 0) {
        console.log(`\n💡 Run without --dry-run to apply changes`);
    }

    if (CONFIG.createBackups && stats.modified > 0 && !DRY_RUN) {
        console.log(`\n📦 Backups created with '${CONFIG.backupSuffix}' extension`);
        console.log(`   To remove backups: rm ${CONFIG.articlesDir}/*${CONFIG.backupSuffix}`);
    }

    console.log('\n✨ Done!\n');
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});