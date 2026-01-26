// scripts/generate-article.js
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// CONFIG
const CONFIG = {
    model: "claude-sonnet-4-20250514",
    maxTokens: 8000,
    maxRetries: 3, // Number of retry attempts for JSON parsing failures
    categories: [
        "Digital Privacy",
        "Digital Security",
        "Online Anonymity",
        "Digital Scams",
        "Future Tech",
        "Policy & Rights",
        "Family Privacy",
        "Digital Wellness",
        "Tech Deep Dive",
    ],
    articlesDir: path.join(__dirname, "../articles"),
    articlesPage: path.join(__dirname, "../articles.html"),
    articleTemplate: path.join(__dirname, "../articles/best-privacy-apps.html"),
};

function toSlug(str) {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim();
}

function getExistingArticles() {
    if (!fs.existsSync(CONFIG.articlesDir)) return [];
    return fs
        .readdirSync(CONFIG.articlesDir)
        .filter((f) => f.endsWith(".html"))
        .map((f) => ({
            name: path.basename(f, ".html"),
            file: f,
            title: toTitle(f),
        }));
}

function toTitle(filename) {
    return filename
        .replace(/-/g, " ")
        .replace(".html", "")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRandomArticles(all, exclude, count = 3) {
    const filtered = all.filter((a) => a.name !== exclude);
    const shuffled = filtered.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, filtered.length));
}

/**
 * Attempts to extract and parse JSON from Claude's response
 * with multiple fallback strategies
 */
function extractJSON(rawText) {
    // Strategy 1: Direct parse (cleanest case)
    try {
        return JSON.parse(rawText);
    } catch (e) {
        console.log("📋 Direct parse failed, trying cleanup strategies...");
    }

    // Strategy 2: Remove markdown code blocks
    let cleaned = rawText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.log("📋 Markdown cleanup failed, trying JSON extraction...");
    }

    // Strategy 3: Extract JSON object using balanced brace matching
    const jsonStart = cleaned.indexOf("{");
    if (jsonStart === -1) {
        throw new Error("No JSON object found in response");
    }

    let braceCount = 0;
    let jsonEnd = -1;

    for (let i = jsonStart; i < cleaned.length; i++) {
        if (cleaned[i] === "{") braceCount++;
        if (cleaned[i] === "}") braceCount--;
        if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
        }
    }

    if (jsonEnd === -1) {
        throw new Error("Unbalanced braces in JSON");
    }

    const jsonString = cleaned.substring(jsonStart, jsonEnd);

    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.log("📋 Extracted JSON still invalid, attempting repairs...");

        // Strategy 4: Try to fix common JSON issues
        let repaired = jsonString
            // Fix unescaped newlines in strings
            .replace(/\n/g, "\\n")
            // Fix unescaped tabs
            .replace(/\t/g, "\\t")
            // Remove trailing commas before } or ]
            .replace(/,\s*([}\]])/g, "$1");

        try {
            return JSON.parse(repaired);
        } catch (finalError) {
            // Log the problematic section for debugging
            console.error("❌ JSON repair failed. First 500 chars of extracted JSON:");
            console.error(jsonString.substring(0, 500));
            throw new Error(`Failed to parse JSON: ${finalError.message}`);
        }
    }
}

/**
 * Build the initial prompt for article generation
 */
function buildInitialPrompt(existingArticles) {
    return `You are a JSON API that generates article data. You MUST respond with ONLY a valid JSON object - no markdown, no explanations, no text before or after the JSON.

Generate a comprehensive article on a trending privacy or cybersecurity topic.

STRICT REQUIREMENTS:
1. Respond with ONLY valid JSON - nothing else
2. Avoid these existing topics: ${existingArticles.map((a) => a.name).join(", ") || "none yet"}
3. The article content MUST be 2000-3000 words
4. Include at least 5 major sections with <h2> tags
5. All quotes and special characters in strings must be properly escaped
6. The "content" field must be valid HTML with escaped quotes

Required JSON structure:
{
  "title": "Complete article title here",
  "category": "One of: Digital Privacy, Digital Security, Online Anonymity, Digital Scams, Future Tech, Policy & Rights, Family Privacy, Digital Wellness, Tech Deep Dive",
  "metaDescription": "SEO meta description, 150-160 characters",
  "keywords": "comma, separated, seo, keywords",
  "readingTime": "X min read",
  "emoji": "🔒",
  "imageColor": "#3b82f6",
  "summary": "2-3 sentence article summary",
  "content": "<h2>Section Title</h2><p>Paragraph content...</p>"
}

CRITICAL: 
- Start your response with { and end with }
- No markdown code blocks
- No text outside the JSON object
- Escape all double quotes inside string values with \\"
- The content field should use single quotes for HTML attributes OR escaped double quotes`;
}

/**
 * Build a retry prompt after JSON parsing failure
 */
function buildRetryPrompt(existingArticles, previousError, attemptNumber) {
    return `Your previous response was not valid JSON. Error: "${previousError}"

I need you to generate a privacy/cybersecurity article as a PURE JSON object.

CRITICAL RULES:
1. Your ENTIRE response must be valid JSON
2. Start with { on the very first character
3. End with } on the very last character
4. NO markdown code blocks (no \`\`\`)
5. NO explanatory text before or after
6. All strings must have properly escaped quotes (\\" not ")

Avoid existing topics: ${existingArticles.map((a) => a.name).join(", ") || "none yet"}

Return this EXACT structure (2000-3000 word article in content field):
{"title":"Article Title","category":"Digital Security","metaDescription":"150 char description","keywords":"keyword1, keyword2","readingTime":"8 min read","emoji":"🔒","imageColor":"#3b82f6","summary":"2-3 sentence summary","content":"<h2>First Section</h2><p>Content here using single quotes for HTML attributes like <a href='link'>text</a>...</p><h2>Second Section</h2><p>More content...</p>"}

Generate a complete, professional article now. Remember: PURE JSON, no wrapper text.`;
}

/**
 * Call Claude API with retry logic for JSON parsing failures
 */
async function callClaudeWithRetry(existingArticles) {
    let lastError = null;
    let lastResponse = null;

    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
        console.log(`🤖 Attempt ${attempt}/${CONFIG.maxRetries}: Calling Claude Sonnet 4...`);

        // Build appropriate prompt based on attempt number
        const prompt = attempt === 1
            ? buildInitialPrompt(existingArticles)
            : buildRetryPrompt(existingArticles, lastError, attempt);

        try {
            const message = await anthropic.messages.create({
                model: CONFIG.model,
                max_tokens: CONFIG.maxTokens,
                messages: [{ role: "user", content: prompt }],
            });

            const rawResponse = message.content.map((c) => c.text).join("\n");
            lastResponse = rawResponse;

            // Log response info for debugging
            console.log(`📊 Response length: ${rawResponse.length} characters`);
            console.log(`📊 Response starts with: "${rawResponse.substring(0, 50).replace(/\n/g, "\\n")}..."`);
            console.log(`📊 Response ends with: ...${rawResponse.substring(rawResponse.length - 50).replace(/\n/g, "\\n")}`);

            // Attempt to parse JSON
            const articleData = extractJSON(rawResponse);
            console.log(`✅ JSON parsed successfully on attempt ${attempt}!`);
            return articleData;

        } catch (error) {
            lastError = error.message;
            console.error(`❌ Attempt ${attempt} failed: ${error.message}`);

            if (attempt < CONFIG.maxRetries) {
                console.log(`🔄 Retrying with corrective prompt...`);
                // Small delay before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    // All retries exhausted - save debug info and throw
    const debugPath = path.join(__dirname, "../debug-response.txt");
    if (lastResponse) {
        fs.writeFileSync(debugPath, lastResponse, "utf8");
        console.error(`💾 Last raw response saved to ${debugPath} for debugging`);
    }

    throw new Error(`Failed to get valid JSON after ${CONFIG.maxRetries} attempts. Last error: ${lastError}`);
}

async function generateArticleData() {
    const existing = getExistingArticles();

    const articleData = await callClaudeWithRetry(existing);

    // Validate required fields
    const requiredFields = ["title", "category", "metaDescription", "content", "summary"];
    for (const field of requiredFields) {
        if (!articleData[field]) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // Set defaults for optional fields
    articleData.keywords = articleData.keywords || "privacy, security, digital";
    articleData.readingTime = articleData.readingTime || "8 min read";
    articleData.emoji = articleData.emoji || "🔒";
    articleData.imageColor = articleData.imageColor || "#3b82f6";

    articleData.filename = `${toSlug(articleData.title)}.html`;

    console.log(`📰 Generated article: "${articleData.title}"`);
    return articleData;
}

function createArticleHTML(articleData) {
    const template = fs.readFileSync(CONFIG.articleTemplate, "utf8");
    const $ = cheerio.load(template);

    $("title").text(`${articleData.title} | NoIdentity.Space`);
    $('meta[name="description"]').attr("content", articleData.metaDescription);
    $('meta[name="keywords"]').attr("content", articleData.keywords);
    $('meta[property="og:title"]').attr("content", articleData.title);
    $('meta[property="og:description"]').attr("content", articleData.metaDescription);

    $(".article-category").first().text(articleData.category);
    $("h1").first().text(articleData.title);

    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    $(".article-meta span").first().text(`📅 ${date}`);
    $(".article-meta span").eq(2).text(`⏱️ ${articleData.readingTime}`);

    $(".featured-image").text(articleData.emoji);

    const contentContainer = $(".article-content");
    contentContainer.find("p, h2, h3, ul, div.tip-box, div.warning-box").remove();

    const contentParts = articleData.content.split("</h2>");
    let finalContent = `<div class="featured-image">${articleData.emoji}</div>`;

    finalContent += `<p><strong>Introduction:</strong> ${articleData.summary}</p>`;

    finalContent += `
    <div class="ad-placeholder">
        <p class="ad-label">Ad Slot 1 Placeholder (Insert AdSense In-Article Code here after approval)</p>
        <ins class="adsbygoogle" style="display:block; text-align:center;"
            data-ad-client="ca-pub-2379517169183719" data-ad-slot="YOUR_AD_SLOT_NUMBER_1" data-ad-format="auto"
            data-full-width-responsive="true"></ins>
    </div>`;

    const sections = contentParts.length;
    contentParts.forEach((part, index) => {
        if (index < sections - 1) {
            finalContent += part + "</h2>";

            if (index === 1) {
                finalContent += `
                <div class="ad-placeholder">
                    <p class="ad-label">Ad Slot 2 Placeholder (Insert AdSense In-Article Code here after approval)</p>
                    <ins class="adsbygoogle" style="display:block; text-align:center;"
                        data-ad-client="ca-pub-2379517169183719" data-ad-slot="YOUR_AD_SLOT_NUMBER_2" data-ad-format="auto"
                        data-full-width-responsive="true"></ins>
                </div>`;
            }
            if (index === 3) {
                finalContent += `
                <div class="ad-placeholder">
                    <p class="ad-label">Ad Slot 3 Placeholder (Insert AdSense In-Article Code here after approval)</p>
                    <ins class="adsbygoogle" style="display:block; text-align:center;"
                        data-ad-client="ca-pub-2379517169183719" data-ad-slot="YOUR_AD_SLOT_NUMBER_3" data-ad-format="auto"
                        data-full-width-responsive="true"></ins>
                </div>`;
            }
        } else {
            finalContent += part;
        }
    });

    finalContent += `
    <div class="share-buttons">
        <a href="#" class="share-button">📱 Share on Twitter</a>
        <a href="#" class="share-button">📘 Share on Facebook</a>
        <a href="#" class="share-button">💼 Share on LinkedIn</a>
        <a href="#" class="share-button">📋 Copy Link</a>
    </div>`;

    finalContent += `
    <div class="author-box">
        <div class="author-avatar">✍️</div>
        <div class="author-info">
            <h4>Written by the NoIdentity Team</h4>
            <p>Our team continuously tests and vets privacy software to ensure you have the most effective tools
                to secure your digital life and maintain your anonymity.</p>
        </div>
    </div>`;

    contentContainer.html(finalContent);

    const toc = $(".toc");
    toc.empty();
    $(".article-content h2").each(function () {
        const heading = $(this);
        const text = heading.text();
        const id = toSlug(text);
        heading.attr("id", id);
        toc.append(`<li><a href="#${id}">${text}</a></li>`);
    });

    return $;
}

function addRelatedArticles($, currentSlug) {
    const allArticles = getExistingArticles();
    const related = getRandomArticles(allArticles, currentSlug, 3);
    if (related.length === 0) return $;

    const relatedSection = $(".sidebar-section").eq(1);
    relatedSection.find("h3").text("Related Articles");
    relatedSection.find("a.related-post").remove();

    related.forEach((article) => {
        relatedSection.append(`
        <a href="${article.file}" class="related-post">
            <h4>📰 ${article.title}</h4>
            <p>Essential privacy reading</p>
        </a>`);
    });

    return $;
}

function updateArticlesPage(articleData) {
    if (!fs.existsSync(CONFIG.articlesPage)) {
        console.warn("⚠️ articles.html not found, skipping update.");
        return;
    }

    const html = fs.readFileSync(CONFIG.articlesPage, "utf8");
    const $ = cheerio.load(html);

    const colorHex = articleData.imageColor.replace("#", "").slice(0, 6);
    const titleEncoded = encodeURIComponent(articleData.title);

    const card = `
  <a href="articles/${articleData.filename}" class="article-card">
      <img src="https://placehold.co/600x400/${colorHex}/ffffff/png?text=${titleEncoded}" alt="${articleData.title}" loading="lazy">
      <div class="card-content">
          <h3>${articleData.title}</h3>
          <p>${articleData.summary}</p>
          <span>${articleData.category}</span>
      </div>
  </a>
  `;

    $(".article-grid").prepend(card);

    fs.writeFileSync(CONFIG.articlesPage, $.html(), "utf8");
    console.log(`🧩 Updated articles.html with "${articleData.title}"`);
}

async function main() {
    try {
        console.log("🚀 Starting article generation...");
        console.log(`📋 Max retries configured: ${CONFIG.maxRetries}`);

        if (!fs.existsSync(CONFIG.articlesDir)) fs.mkdirSync(CONFIG.articlesDir);

        const articleData = await generateArticleData();
        let $ = createArticleHTML(articleData);

        $ = addRelatedArticles($, toSlug(articleData.title));

        const html = $.html();
        const outputPath = path.join(CONFIG.articlesDir, articleData.filename);
        fs.writeFileSync(outputPath, html, "utf8");

        console.log(`✅ Created new article: ${outputPath}`);
        updateArticlesPage(articleData);

        fs.writeFileSync(".article-title.txt", articleData.title, "utf8");
        fs.writeFileSync(
            "article-report.txt",
            `📰 ${articleData.title}\n📂 ${articleData.filename}\n🏷️ ${articleData.category}\n\nSummary:\n${articleData.summary}\n`,
            "utf8"
        );

        console.log("🎉 Article generation complete!");
    } catch (error) {
        console.error("❌ Failed:", error);
        process.exit(1);
    }
}

main();