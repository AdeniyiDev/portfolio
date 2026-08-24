// Fetches the latest posts from the Hashnode RSS feed and rewrites the
// hardcoded `posts` array in blog.html between the AUTO-POSTS markers.
// Run via the GitHub Action in .github/workflows/update-blog.yml — no
// need to run this by hand unless you're testing locally.

import { XMLParser } from "fast-xml-parser";
import { readFile, writeFile } from "fs/promises";

const RSS_URL = "https://opsspherehq.hashnode.dev/rss.xml";
const BLOG_FILE = "blog.html";
const POST_COUNT = 3;

const START_MARKER = "// AUTO-POSTS-START (do not edit this line, or the one below — the GitHub Action replaces everything between them)";
const END_MARKER = "// AUTO-POSTS-END";

function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(text, len) {
  return text.length > len ? text.slice(0, len).trim() + "…" : text;
}

function extractCoverImage(item) {
  // Hashnode RSS puts the cover image as the first <img> in content:encoded
  const content = item["content:encoded"] || item.description || "";
  const match = /<img[^>]+src="([^"]+)"/i.exec(content);
  return match ? match[1] : null;
}

function toIsoDate(pubDate) {
  const d = new Date(pubDate);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function main() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": "blog-sync-bot" } });
  if (!res.ok) throw new Error(`Failed to fetch RSS feed: ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (list.length === 0) throw new Error("No <item> entries found in RSS feed");

  const posts = list.slice(0, POST_COUNT).map((item) => {
    const brief = truncate(stripHtml(item.description || ""), 160);
    return {
      title: (item.title || "").trim(),
      brief,
      url: (item.link || "").trim(),
      publishedAt: toIsoDate(item.pubDate) || "",
      tags: [], // Hashnode RSS doesn't include tags; left empty, edit manually if you want chips
      coverImage: extractCoverImage(item),
    };
  });

  const arrayBody = posts
    .map((p) => {
      const tagsStr = JSON.stringify(p.tags);
      const coverLine = p.coverImage ? `,\n      coverImage: ${JSON.stringify(p.coverImage)}` : "";
      return `    {\n      title: ${JSON.stringify(p.title)},\n      brief: ${JSON.stringify(p.brief)},\n      url: ${JSON.stringify(p.url)},\n      publishedAt: ${JSON.stringify(p.publishedAt)},\n      tags: ${tagsStr}${coverLine}\n    }`;
    })
    .join(",\n");

  const newBlock = `${START_MARKER}\n  const posts = [\n${arrayBody}\n  ];\n  ${END_MARKER}`;

  const html = await readFile(BLOG_FILE, "utf8");
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find AUTO-POSTS markers in blog.html — did someone edit them?");
  }
  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx + END_MARKER.length);
  const updatedHtml = `${before}${newBlock}${after}`;

  if (updatedHtml === html) {
    console.log("No changes — blog.html already up to date.");
    return;
  }

  await writeFile(BLOG_FILE, updatedHtml, "utf8");
  console.log(`Updated blog.html with ${posts.length} posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
