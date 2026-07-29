/**
 * supabase/seed.ts
 *
 * Seed script — inserts 7 example markets using the Supabase service-role key.
 * Run with:  npx tsx supabase/seed.ts
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in .env.local
 *   - An admin user already signed in once (so their profile row exists)
 *   - ADMIN_EMAIL set in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ─── Load .env.local ─────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local not found. Copy .env.local.example and fill in values.");
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val) process.env[key] = val;
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.ADMIN_EMAIL;

if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
  console.error(
    "Missing env vars. Ensure NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_EMAIL are set in .env.local"
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ─── Seed Data ────────────────────────────────────────────────────────────────
const MARKETS = [
  {
    title: "Will our school win the state championship this year?",
    description:
      "Resolves YES if the school wins the state overall championship title before the end of the school year.",
    category: "sports",
    yes_pool: 320,
    no_pool: 180,
    is_featured: true,
    resolution_date: new Date(
      new Date().setMonth(new Date().getMonth() + 3)
    ).toISOString(),
  },
  {
    title: "Will the boys basketball team finish with a winning record?",
    description:
      "Resolves YES if the varsity boys basketball team wins more than 50% of their regular-season games.",
    category: "sports",
    yes_pool: 250,
    no_pool: 150,
    is_featured: false,
    resolution_date: new Date(
      new Date().setMonth(new Date().getMonth() + 2)
    ).toISOString(),
  },
  {
    title: "Will the school lunch menu change in the next 30 days?",
    description:
      "Resolves YES if the cafeteria introduces at least one new menu item or removes an existing staple within 30 days.",
    category: "actions",
    yes_pool: 100,
    no_pool: 300,
    is_featured: false,
    resolution_date: new Date(
      new Date().setDate(new Date().getDate() + 30)
    ).toISOString(),
  },
  {
    title: "Will school be cancelled for a snow day before spring break?",
    description:
      "Resolves YES if school is cancelled or delayed due to weather at least once before spring break.",
    category: "actions",
    yes_pool: 400,
    no_pool: 100,
    is_featured: false,
    resolution_date: new Date(
      new Date().setMonth(new Date().getMonth() + 2)
    ).toISOString(),
  },
  {
    title: "Will the most-followed student account hit 1k Instagram followers?",
    description:
      "Resolves YES if any current student's verified personal Instagram account reaches 1,000 followers before June 1.",
    category: "social",
    yes_pool: 180,
    no_pool: 220,
    is_featured: false,
    resolution_date: new Date(`${new Date().getFullYear()}-06-01`).toISOString(),
  },
  {
    title: "Will a student go viral on TikTok this semester?",
    description:
      "Resolves YES if a video by a student receives more than 500,000 views on TikTok before the end of the semester.",
    category: "trending",
    yes_pool: 200,
    no_pool: 200,
    is_featured: false,
    resolution_date: new Date(
      new Date().setMonth(new Date().getMonth() + 4)
    ).toISOString(),
  },
  {
    title: "Will the school host a pep rally before the end of the school year?",
    description:
      "Resolves YES if the school organizes at least one all-school pep rally before the final day of the school year.",
    category: "social",
    yes_pool: 350,
    no_pool: 150,
    is_featured: false,
    resolution_date: new Date(
      new Date().setMonth(new Date().getMonth() + 5)
    ).toISOString(),
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Forecast — Seed Script");
  console.log("─".repeat(40));

  // Look up admin user by email
  const { data: authUsers, error: authError } =
    await admin.auth.admin.listUsers();
  if (authError) {
    console.error("Failed to list auth users:", authError.message);
    process.exit(1);
  }

  const adminAuthUser = authUsers.users.find((u) => u.email === adminEmail);
  if (!adminAuthUser) {
    console.error(
      `Admin user with email "${adminEmail}" not found in auth.users.`,
      "\nSign in to the app with that account first."
    );
    process.exit(1);
  }

  const adminId = adminAuthUser.id;
  console.log(`✓ Found admin user: ${adminEmail} (${adminId})`);

  // Wipe existing seed markets to allow re-running
  const { error: deleteError } = await admin
    .from("markets")
    .delete()
    .eq("creator_id", adminId);

  if (deleteError) {
    console.warn("Warning: Could not delete existing markets:", deleteError.message);
  } else {
    console.log("✓ Cleared existing admin-created markets");
  }

  // Insert markets
  let inserted = 0;
  for (const market of MARKETS) {
    const { error } = await admin.from("markets").insert({
      ...market,
      creator_id: adminId,
      status: "open",
    });

    if (error) {
      console.error(`✗ Failed to insert "${market.title}":`, error.message);
    } else {
      console.log(`✓ Created market: ${market.title}`);
      inserted++;
    }
  }

  console.log("─".repeat(40));
  console.log(`🎉 Done. ${inserted}/${MARKETS.length} markets seeded.`);
}

seed().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
