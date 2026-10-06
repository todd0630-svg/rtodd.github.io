// Posts a daily digest of the newest cannabis/hemp/psychedelic headlines (same feed as news.html).
// Env: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, SITE_URL, DRY_RUN, MAX_ITEMS, WINDOW_HOURS
const {
  LINKEDIN_ACCESS_TOKEN: token,
  LINKEDIN_AUTHOR_URN: author,
  SITE_URL = "https://www.tokenhaven.org",
  DRY_RUN,
  MAX_ITEMS = "8",
  WINDOW_HOURS = "26",
} = process.env;
const dryRun = DRY_RUN === "true";
const PUBMED =
  "https://zkarexhmqozyekwpgsug.supabase.co/functions/v1/pubmed-feed?apikey=sb_publishable_CGnWqiqvGRw6RECLHeo2LQ_MEmISGUB";
const FEED =
  "https://zkarexhmqozyekwpgsug.supabase.co/functions/v1/news-feed?apikey=sb_publishable_CGnWqiqvGRw6RECLHeo2LQ_MEmISGUB";

const escapeText = (s) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

function apiVersion() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return process.env.LINKEDIN_VERSION || `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const feedRes = await fetch(FEED);
if (!feedRes.ok) throw new Error(`News feed returned ${feedRes.status}`);
const { items = [] } = await feedRes.json();

const cutoff = Date.now() - Number(WINDOW_HOURS) * 3600 * 1000;
const fresh = items
  .filter((i) => i.title && new Date(i.published || 0).getTime() >= cutoff)
  .sort((a, b) => new Date(b.published) - new Date(a.published))
  .slice(0, Number(MAX_ITEMS));

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// Latest peer-reviewed research is best-effort: a PubMed failure must not block the news digest.
let research = [];
try {
  const pm = await fetch(PUBMED);
  if (pm.ok) {
    const { articles = [] } = await pm.json();
    research = articles
      .filter((a) => a.title)
      .sort((a, b) => String(b.publicationDate).localeCompare(String(a.publicationDate)))
      .slice(0, 3);
  }
} catch (e) {
  console.warn(`PubMed feed unavailable: ${e.message}`);
}

if (!fresh.length) {
  console.log("No new headlines in the window; nothing to post.");
  process.exit(0);
}

const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
const newsLines = fresh.map((i) => `• ${decode(i.title).trim()} (${(i.source || "Industry News").trim()})`);
const researchLines = research.map(
  (a) => `• ${decode(a.title).trim().replace(/\.$/, "")} - ${decode(a.journal || "").trim()} (${a.publicationDate})\nhttps://pubmed.ncbi.nlm.nih.gov/${a.uid}/`,
);

function build(n, r) {
  const parts = [`Cannabis, Hemp + Psychedelic News Roundup - ${date}`];
  if (n) parts.push(`Top Headlines\n\n${newsLines.slice(0, n).join("\n\n")}`);
  if (r) parts.push(`Latest Published Peer Reviewed Research\n\n${researchLines.slice(0, r).join("\n\n")}`);
  parts.push("Full coverage on TokenHaven.");
  return escapeText(parts.join("\n\n")) + "\n\n#Cannabis #Hemp #Psychedelics";
}

// LinkedIn caps commentary at 3000 characters; drop items instead of truncating mid-text.
let n = newsLines.length;
let r = researchLines.length;
let commentary = build(n, r);
while (commentary.length > 2900 && (n > 1 || r > 0)) {
  if (r > 0) r--;
  else n--;
  commentary = build(n, r);
}
const link = `${SITE_URL.replace(/\/$/, "")}/news.html`;

const payload = {
  author,
  commentary,
  visibility: "PUBLIC",
  distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
  content: { article: { source: link, title: "TokenHaven - Cannabis, Hemp + Psychedelic News", description: "Daily industry headlines." } },
  lifecycleState: "PUBLISHED",
  isReshareDisabledByAuthor: false,
};

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
if (!token || !author) {
  console.error("LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be set.");
  process.exit(1);
}
const res = await fetch("https://api.linkedin.com/rest/posts", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`LinkedIn ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Posted digest of ${fresh.length} headlines -> ${res.headers.get("x-restli-id")}`);
