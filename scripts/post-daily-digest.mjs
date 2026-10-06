// Posts a daily digest of the newest cannabis/hemp/psychedelic headlines (same feed as news.html).
// Env: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, SITE_URL, DRY_RUN, MAX_ITEMS, WINDOW_HOURS
const {
  LINKEDIN_ACCESS_TOKEN: token,
  LINKEDIN_AUTHOR_URN: author,
  SITE_URL = "https://www.tokenhaven.org",
  DRY_RUN,
  MAX_ITEMS = "5",
  WINDOW_HOURS = "26",
} = process.env;
const dryRun = DRY_RUN === "true";
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

if (!fresh.length) {
  console.log("No new headlines in the window; nothing to post.");
  process.exit(0);
}

const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
const lines = fresh.map((i) => `• ${i.title.trim()} (${(i.source || "Industry News").trim()})`);
const commentary =
  escapeText(`Cannabis, Hemp + Psychedelic News Roundup - ${date}\n\n${lines.join("\n\n")}\n\nFull coverage on TokenHaven.`) +
  "\n\n#Cannabis #Hemp #Psychedelics";
const link = `${SITE_URL.replace(/\/$/, "")}/news.html`;

const payload = {
  author,
  commentary: commentary.slice(0, 2900),
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
