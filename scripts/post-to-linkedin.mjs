// Posts newly added articles (articles/*.md) to LinkedIn.
// Env: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, SITE_URL, BEFORE_SHA, AFTER_SHA, DRY_RUN
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const {
  LINKEDIN_ACCESS_TOKEN: token,
  LINKEDIN_AUTHOR_URN: author,
  SITE_URL = "",
  BEFORE_SHA,
  AFTER_SHA = "HEAD",
  DRY_RUN,
} = process.env;
const dryRun = DRY_RUN === "true";

function newArticleFiles() {
  if (process.argv[2]) return process.argv.slice(2);
  const base = BEFORE_SHA && !/^0+$/.test(BEFORE_SHA) ? BEFORE_SHA : `${AFTER_SHA}~1`;
  const out = execSync(
    `git diff --name-only --diff-filter=A ${base} ${AFTER_SHA} -- articles`,
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".md") && !path.basename(f).startsWith("_") && path.basename(f).toLowerCase() !== "readme.md");
}

function parseFrontMatter(text) {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("missing front matter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

// LinkedIn "little text" format reserves these characters.
const escapeText = (s) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

async function post(file) {
  const { meta } = parseFrontMatter(readFileSync(file, "utf8"));
  if (!meta.title) throw new Error(`${file}: title is required`);
  const link = meta.url || `${SITE_URL.replace(/\/$/, "")}/news.html`;
  const commentary = [escapeText([meta.title, meta.summary].filter(Boolean).join("\n\n")), meta.hashtags]
    .filter(Boolean)
    .join("\n\n");
  const payload = {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { article: { source: link, title: meta.title, description: meta.summary || "" } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (dryRun) {
    console.log(`[dry run] ${file}\n${JSON.stringify(payload, null, 2)}`);
    return;
  }
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": "202504",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${file}: LinkedIn ${res.status} ${await res.text()}`);
  console.log(`Posted ${file} -> ${res.headers.get("x-restli-id")}`);
}

const files = newArticleFiles();
if (!files.length) {
  console.log("No new articles to post.");
  process.exit(0);
}
if (!dryRun && (!token || !author)) {
  console.error("LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be set.");
  process.exit(1);
}
let failed = false;
for (const f of files) {
  try {
    await post(f);
  } catch (e) {
    failed = true;
    console.error(e.message);
  }
}
process.exit(failed ? 1 : 0);
