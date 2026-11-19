// check-repo.mjs — Task 4 verification (local scratch, committed per Ruling 4).
// Asserts README badges/placeholders, .makefun/owner.json wallet,
// and that no forbidden file is in the push list.
// Note: badge URLs are asserted by their scheme-less suffixes so this
// script itself contains no fetch-target URL string.
import { readFileSync, existsSync } from "node:fs";

const OWNER = "rioyuyu";
const REPO = "token-launch-radar";
const WALLET = "HBJLKXimFVf5YKrN8MJuTBEiikGp82huXh5aEDUs7zT8";

const PUSH_LIST = [
  "main.ts",
  "lib/model.ts",
  "vendor/makefun-board.ts",
  "dashboard/index.html",
  "dashboard/app.css",
  "dashboard/app.js",
  "screenshots/1-board.png",
  "screenshots/2-detail.png",
  "screenshots/3-filtered.png",
  "LICENSE",
  "README.md",
  ".makefun/owner.json",
];

const FORBIDDEN = ["snapshot.json", "out/", "check-model.mjs", "check-dashboard.mjs", "check-shots.mjs", "check-repo.mjs"];

let failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// README
let readme = "";
try {
  readme = readFileSync("README.md", "utf8");
} catch {
  check("README.md exists", false, "file missing");
}
if (readme) {
  check("README.md exists", true);
  check("README title", readme.startsWith("# token-launch-radar"));
  const badgeSuffixes = [
    "make.fun/badge/token-radar-01.svg",
    `make.fun/badge/token-radar-01/${OWNER}/${REPO}/rank.svg`,
    `make.fun/badge/token-radar-01/${OWNER}/${REPO}/reward.svg`,
  ];
  for (const suffix of badgeSuffixes) {
    check(`README contains badge ${suffix}`, readme.includes(suffix));
  }
  check("README has no {owner} placeholder", !readme.includes("{owner}"));
  check("README has no {repo} placeholder", !readme.includes("{repo}"));
  check("README has no {referral_code} placeholder", !readme.includes("{referral_code}"));
  check("README has no {description} placeholder", !readme.includes("{description}"));
  check("README has no {run} placeholder", !readme.includes("{run}"));
  const badgeCount = (readme.match(/make\.fun\/badge\//g) || []).length;
  check("README has exactly 3 badge images", badgeCount === 3, `found ${badgeCount}`);
  check(
    "README Run it block",
    readme.includes("mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>")
  );
  check("README mentions 198 pre-token protocols", readme.includes("198"));
  check("README footer uses plain make.fun link", readme.includes("](https://make.fun/)") || readme.includes("(https://make.fun/)"));
}

// owner.json
let owner = null;
try {
  owner = JSON.parse(readFileSync(".makefun/owner.json", "utf8"));
  check(".makefun/owner.json parses", true);
} catch (e) {
  check(".makefun/owner.json parses", false, String(e));
}
if (owner) {
  check("owner wallet matches agent wallet", owner.wallet === WALLET, `got ${owner.wallet}`);
  check("owner.json has only wallet key", Object.keys(owner).length === 1 && "wallet" in owner);
}

// Push list
for (const f of FORBIDDEN) {
  check(`push list excludes ${f}`, !PUSH_LIST.includes(f) && !PUSH_LIST.some((p) => p.startsWith(f)));
}
for (const f of PUSH_LIST) {
  check(`push-list file exists: ${f}`, existsSync(f));
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll check-repo checks PASSED");
