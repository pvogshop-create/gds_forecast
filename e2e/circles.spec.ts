import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loginAs, logout } from "./helpers/auth";
import { admin, anonClientFor } from "./helpers/db";
import { expectCanRead, expectCannotRead, expectCannotWrite } from "./helpers/rls";
import { CIRCLES, USERS, type UserKey } from "./helpers/fixtures";
import {
  addCircleMember,
  createCircle,
  getCircleBySlug,
  loadSeededUsers,
  userId,
  type SeededCircle,
} from "./helpers/seed";

/**
 * Circles — migration 0029.
 *
 * Two things are under test and they fail in different ways:
 *
 *   1. The RLS boundary. It fails SILENTLY, so every negative case here is a
 *      direct-by-ID read: a user who should not see a circle must get `[]` even
 *      when they hand PostgREST its exact UUID. Being absent from a list is not
 *      access control — anyone who scraped an id out of a shared link asks by id.
 *   2. The join path. It fails LOUDLY but rarely, under concurrency, so the cap
 *      and idempotency cases run parallel calls rather than sequential ones.
 *
 * Nothing here asserts through `admin` (service_role) — it bypasses RLS, so a
 * policy test written against it is green no matter what the policy says.
 * `admin` appears only to establish and verify fixtures.
 *
 * The circles themselves are seeded globally (global-setup.ts) because circle
 * membership is part of the fixture users' identity: Carol IS "in Alice's circle
 * but not her league" in every spec, not just this one.
 */

let circleX: SeededCircle;
let circleY: SeededCircle;
let circleOpen: SeededCircle;

const clients: Partial<Record<UserKey, SupabaseClient>> = {};

async function clientFor(key: UserKey): Promise<SupabaseClient> {
  const existing = clients[key];
  if (existing) return existing;
  const client = await anonClientFor(USERS[key].email);
  clients[key] = client;
  return client;
}

test.beforeAll(async () => {
  // The seeded-id cache is per worker process, not global.
  await loadSeededUsers();
  circleX = await getCircleBySlug(CIRCLES.x.slug);
  circleY = await getCircleBySlug(CIRCLES.y.slug);
  circleOpen = await getCircleBySlug(CIRCLES.open.slug);
});

/**
 * Drop every ad-hoc circle a test created, keeping only the three global matrix
 * circles.
 *
 * Without this the suite fails on itself: the join_circle tests deliberately put
 * Erin into circles, and Erin's whole purpose is being the user who is in
 * nothing. The empty-state test then sees leftover memberships and fails — a
 * failure that reproduces only in a full-file run and passes in isolation, which
 * is the most expensive kind to diagnose.
 *
 * Deleting the circle cascades its memberships, so this is one statement.
 */
test.afterEach(async () => {
  const keep = [CIRCLES.x.slug, CIRCLES.y.slug, CIRCLES.open.slug];
  await admin
    .from("circles")
    .delete()
    .like("name", "[E2E]%")
    .not("slug", "in", `(${keep.join(",")})`);
});

// ─── Schema, trigger and constraints ────────────────────────────────────────

test.describe("circles schema", () => {
  test("create_circle writes the creator's membership in the same transaction", async () => {
    const circle = await createCircle({ creator: "owner" });

    const { data } = await admin
      .from("circle_members")
      .select("user_id, role")
      .eq("circle_id", circle.id);

    expect(data).toEqual([{ user_id: userId("owner"), role: "creator" }]);

    // The RPC re-reads after the trigger fires, so the returned count is 1 and
    // not the pre-trigger 0 that a bare RETURNING would have given.
    const { data: row } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(row?.member_count).toBe(1);
  });

  test("member_count tracks inserts and deletes", async () => {
    const circle = await createCircle();

    async function count(): Promise<number> {
      const { data } = await admin
        .from("circles")
        .select("member_count")
        .eq("id", circle.id)
        .single();
      return data?.member_count as number;
    }

    expect(await count()).toBe(1); // creator

    await addCircleMember(circle.id, userId("alice"));
    expect(await count()).toBe(2);

    await addCircleMember(circle.id, userId("bob"));
    expect(await count()).toBe(3);

    await admin
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("bob"));
    expect(await count()).toBe(2);
  });

  test("a duplicate slug is rejected", async () => {
    const circle = await createCircle();
    const { error } = await admin.rpc("create_circle", {
      p_name: "[E2E] Duplicate slug",
      p_slug: circle.slug,
      p_creator_id: userId("owner"),
      p_description: null,
      p_joining_policy: "open",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/duplicate key|unique/i);
  });

  test.describe("the slug CHECK rejects anything that is not a URL segment", () => {
    // The slug is a route segment (/circles/[slug]). Without the constraint an
    // admin typo mints a circle that is unreachable or that shadows a sibling
    // route, and neither shows up until someone clicks the link.
    for (const [label, slug] of [
      ["spaces", "bad slug"],
      ["punctuation", "bad_slug!"],
      ["too short", "ab"],
      ["slashes", "a/b"],
      ["too long", "a".repeat(41)],
      ["trailing hyphen is fine but empty is not", ""],
    ] as const) {
      test(label, async () => {
        const { error } = await admin.rpc("create_circle", {
          p_name: `[E2E] Bad slug ${label}`,
          p_slug: slug,
          p_creator_id: userId("owner"),
          p_description: null,
          p_joining_policy: "open",
        });
        expect(error, `slug "${slug}" should have been rejected`).not.toBeNull();
      });
    }

    test("uppercase is normalized rather than rejected", async () => {
      // create_circle lower()s the slug before inserting, so a capitalised slug
      // is corrected, not refused. The CHECK still guards the table against a
      // direct insert that skips the RPC — asserted separately below.
      const circle = await createCircle({ slug: "E2E-Mixed-Case-Slug" });
      expect(circle.slug).toBe("e2e-mixed-case-slug");
    });

    test("the table CHECK still guards a direct service_role insert", async () => {
      const { error } = await admin.from("circles").insert({
        name: "[E2E] Direct bad slug",
        slug: "Not A Slug",
        creator_id: userId("owner"),
      });
      expect(error, "the slug CHECK did not fire on a direct insert").not.toBeNull();
    });
  });

  test("deleting a circle cascades its members and leaves no orphans", async () => {
    const circle = await createCircle({
      members: [{ user: "alice" }, { user: "bob" }],
    });

    await admin.from("circles").delete().eq("id", circle.id);

    const { data } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id);
    expect(data ?? []).toEqual([]);
  });
});

// ─── RLS: circles ───────────────────────────────────────────────────────────

test.describe("circles RLS", () => {
  test("a member reads their own circle", async () => {
    await expectCanRead(await clientFor("alice"), "circles", circleX.id, "alice → Circle X");
    await expectCanRead(await clientFor("carol"), "circles", circleX.id, "carol → Circle X");
    await expectCanRead(await clientFor("mod"), "circles", circleX.id, "mod → Circle X");
    await expectCanRead(await clientFor("owner"), "circles", circleX.id, "owner → Circle X");
    await expectCanRead(await clientFor("dave"), "circles", circleY.id, "dave → Circle Y");
  });

  test("anyone reads an open circle", async () => {
    // The `joining_policy = 'open'` branch of circles_select. Erin is in
    // nothing, so if she can read it, the branch is doing the work.
    await expectCanRead(await clientFor("erin"), "circles", circleOpen.id, "erin → open circle");
  });

  test("a non-member cannot read an invite-code circle by id", async () => {
    // Bob is in Alice's LEAGUE but not her circle — the boundary that a
    // membership-agnostic policy would miss.
    await expectCannotRead(await clientFor("bob"), "circles", circleX.id, "bob → Circle X");
    await expectCannotRead(await clientFor("dave"), "circles", circleX.id, "dave → Circle X");
    await expectCannotRead(await clientFor("erin"), "circles", circleX.id, "erin → Circle X");

    // And the other direction, so the test cannot pass by denying everyone.
    await expectCannotRead(await clientFor("alice"), "circles", circleY.id, "alice → Circle Y");
    await expectCannotRead(await clientFor("carol"), "circles", circleY.id, "carol → Circle Y");
  });

  test("a non-member cannot see the circle in a list either", async () => {
    const bob = await clientFor("bob");
    const { data, error } = await bob.from("circles").select("id, slug");
    expect(error).toBeNull();
    const slugs = (data ?? []).map((c) => c.slug);
    expect(slugs).not.toContain(CIRCLES.x.slug);
    expect(slugs).not.toContain(CIRCLES.y.slug);
    // The open circle is the control: if this were empty for the wrong reason
    // (a broken client, no session) the assertions above would be vacuous.
    expect(slugs).toContain(CIRCLES.open.slug);
  });

  test("no authenticated user can create a circle directly", async () => {
    // Creation is admin-only; circles_insert is service_role. Without this the
    // admin-only decision lives only in the UI, which is not a control.
    await expectCannotWrite(
      await clientFor("alice"),
      "circles",
      {
        name: "[E2E] Alice's rogue circle",
        slug: "e2e-rogue-alice",
        creator_id: userId("alice"),
      },
      "alice inserts a circle"
    );
  });

  test("a plain member cannot update the circle; a moderator can", async () => {
    const alice = await clientFor("alice");
    const { error: aliceError } = await alice
      .from("circles")
      .update({ description: "hijacked" })
      .eq("id", circleX.id);

    // An UPDATE denied by RLS does not error — the USING clause filters the row
    // out and zero rows match. So the proof is the value, not the error.
    expect(aliceError).toBeNull();
    const { data: afterAlice } = await admin
      .from("circles")
      .select("description")
      .eq("id", circleX.id)
      .single();
    expect(
      afterAlice?.description,
      "LEAK: a plain member rewrote the circle description"
    ).not.toBe("hijacked");

    const mod = await clientFor("mod");
    await mod.from("circles").update({ description: "set by mod" }).eq("id", circleX.id);
    const { data: afterMod } = await admin
      .from("circles")
      .select("description")
      .eq("id", circleX.id)
      .single();
    expect(afterMod?.description).toBe("set by mod");
  });

  test("no authenticated user can delete a circle", async () => {
    const mod = await clientFor("mod");
    await mod.from("circles").delete().eq("id", circleX.id);
    const { data } = await admin.from("circles").select("id").eq("id", circleX.id);
    expect(data ?? [], "LEAK: a moderator deleted a circle").toHaveLength(1);
  });
});

// ─── RLS: circle_members ────────────────────────────────────────────────────
//
// These read assertions are written by hand rather than through expectCanRead /
// expectCannotRead: those helpers verify the fixture with `.eq("id", …)`, and
// circle_members has a composite primary key and no `id` column.

test.describe("circle_members RLS", () => {
  test("a member reads the full roster of their circle", async () => {
    const alice = await clientFor("alice");
    const { data, error } = await alice
      .from("circle_members")
      .select("user_id, role")
      .eq("circle_id", circleX.id);

    expect(error).toBeNull();
    const byUser = Object.fromEntries((data ?? []).map((r) => [r.user_id, r.role]));
    expect(byUser[userId("owner")]).toBe("creator");
    expect(byUser[userId("mod")]).toBe("moderator");
    expect(byUser[userId("alice")]).toBe("member");
    expect(byUser[userId("carol")]).toBe("member");
  });

  test("a non-member reads no rows of that roster, by circle id", async () => {
    for (const key of ["bob", "dave", "erin"] as const) {
      const client = await clientFor(key);
      const { data, error } = await client
        .from("circle_members")
        .select("user_id")
        .eq("circle_id", circleX.id);

      // Filtered, not errored. An error would mean something else broke — a
      // recursive policy (42P17, the 0024 bug) reads as "denied" if you only
      // check for truthiness, which is how that outage stayed invisible.
      expect(error, `${key} roster read errored instead of filtering`).toBeNull();
      expect(data ?? [], `LEAK: ${key} read the Circle X roster`).toEqual([]);
    }
  });

  test("a non-member cannot read a single membership row by its exact key", async () => {
    const dave = await clientFor("dave");
    const { data, error } = await dave
      .from("circle_members")
      .select("user_id, role")
      .eq("circle_id", circleX.id)
      .eq("user_id", userId("alice"));

    expect(error).toBeNull();
    expect(data ?? [], "LEAK: dave read alice's Circle X membership by exact key").toEqual([]);
  });

  test("the policy is not recursive", async () => {
    // circle_members_select goes through is_circle_member(), a SECURITY DEFINER
    // helper, precisely so it does not re-enter its own policy. When 0003 wrote
    // the league equivalent as a self-subquery, every authenticated read of
    // every league table died with 42P17 and the feature was dead for months.
    // A plain successful read is the whole assertion.
    const erin = await clientFor("erin");
    const { error } = await erin.from("circle_members").select("user_id").limit(1);
    expect(
      error,
      "circle_members SELECT errored — if this is 42P17 the policy recursed (see 0024)"
    ).toBeNull();
  });

  test("nobody can insert a membership directly — not for others, not for themselves", async () => {
    // circle_members_insert is service_role only. A self-insert policy would be
    // a way around join_circle(), which is the only place the member cap and
    // the joining_policy are enforced.
    await expectCannotWrite(
      await clientFor("bob"),
      "circle_members",
      { circle_id: circleX.id, user_id: userId("bob"), role: "member" },
      "bob joins Circle X directly"
    );

    await expectCannotWrite(
      await clientFor("bob"),
      "circle_members",
      { circle_id: circleX.id, user_id: userId("erin"), role: "member" },
      "bob adds erin to Circle X"
    );

    // Even a member of the circle cannot add someone.
    await expectCannotWrite(
      await clientFor("alice"),
      "circle_members",
      { circle_id: circleX.id, user_id: userId("erin"), role: "member" },
      "alice adds erin to her own circle"
    );

    // And nobody can promote themselves on the way in.
    await expectCannotWrite(
      await clientFor("erin"),
      "circle_members",
      { circle_id: circleOpen.id, user_id: userId("erin"), role: "moderator" },
      "erin self-inserts as moderator of the open circle"
    );
  });

  test("a member can leave; the creator cannot be removed", async () => {
    const circle = await createCircle({ members: [{ user: "alice" }] });
    const alice = await clientFor("alice");

    await alice
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("alice"));

    const { data: afterLeave } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id);
    expect(afterLeave ?? []).toEqual([{ user_id: userId("owner") }]);

    // The creator's own row is protected: a circle whose creator row is gone
    // has no owner and, because circles_select is membership-based, becomes
    // invisible to everyone including the person who made it.
    const owner = await clientFor("owner");
    await owner
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("owner"));

    const { data: afterSelfDelete } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id);
    expect(
      afterSelfDelete ?? [],
      "LEAK: the creator deleted their own membership, orphaning the circle"
    ).toHaveLength(1);
  });

  test("a moderator can remove a member but not the creator", async () => {
    const circle = await createCircle({
      members: [{ user: "mod", role: "moderator" }, { user: "alice" }],
    });
    const mod = await clientFor("mod");

    await mod
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("alice"));
    const { data: afterRemove } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("alice"));
    expect(afterRemove ?? []).toEqual([]);

    // is_circle_moderator() is true for the creator too, so without the
    // explicit role <> 'creator' guard a moderator could depose the owner.
    await mod
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("owner"));
    const { data: creatorRow } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("owner"));
    expect(creatorRow ?? [], "LEAK: a moderator removed the creator").toHaveLength(1);
  });

  test("a plain member cannot remove another member", async () => {
    const circle = await createCircle({
      members: [{ user: "alice" }, { user: "carol" }],
    });
    const alice = await clientFor("alice");

    await alice
      .from("circle_members")
      .delete()
      .eq("circle_id", circle.id)
      .eq("user_id", userId("carol"));

    const { data } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("carol"));
    expect(data ?? [], "LEAK: a plain member removed someone else").toHaveLength(1);
  });
});

// ─── RPCs ───────────────────────────────────────────────────────────────────

test.describe("find_circle_by_invite_code", () => {
  test("a non-member resolves a circle they cannot otherwise read", async () => {
    // This is the entire reason the RPC exists. Leagues shipped without it and
    // reported every VALID invite code as invalid for months, because the
    // prospective member is not yet a member and the SELECT policy hides the
    // row from them. Proving both halves in one test keeps them tied together.
    const bob = await clientFor("bob");
    await expectCannotRead(bob, "circles", circleX.id, "bob → Circle X (direct)");

    const { data, error } = await bob.rpc("find_circle_by_invite_code", {
      p_code: circleX.inviteCode,
    });
    expect(error).toBeNull();
    const match = Array.isArray(data) ? data[0] : data;
    expect(match?.id).toBe(circleX.id);
    expect(match?.is_member).toBe(false);
  });

  test("the lookup is case- and whitespace-insensitive", async () => {
    const bob = await clientFor("bob");
    const { data } = await bob.rpc("find_circle_by_invite_code", {
      p_code: `  ${circleX.inviteCode.toLowerCase()}  `,
    });
    const match = Array.isArray(data) ? data[0] : data;
    expect(match?.id).toBe(circleX.id);
  });

  test("a bogus code returns nothing rather than erroring", async () => {
    const bob = await clientFor("bob");
    const { data, error } = await bob.rpc("find_circle_by_invite_code", {
      p_code: "NOTACODE",
    });
    expect(error).toBeNull();
    expect(Array.isArray(data) ? data : [data].filter(Boolean)).toEqual([]);
  });

  test("it reports is_member for someone already in", async () => {
    const alice = await clientFor("alice");
    const { data } = await alice.rpc("find_circle_by_invite_code", {
      p_code: circleX.inviteCode,
    });
    const match = Array.isArray(data) ? data[0] : data;
    expect(match?.is_member).toBe(true);
  });
});

test.describe("join_circle", () => {
  test("an open circle admits anyone with no code", async () => {
    const circle = await createCircle({ joiningPolicy: "open" });
    const erin = await clientFor("erin");

    const { error } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: null,
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("circle_members")
      .select("user_id, role")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("erin"));
    expect(data).toEqual([{ user_id: userId("erin"), role: "member" }]);
  });

  test("an invite-code circle admits the right code and refuses the wrong one", async () => {
    const circle = await createCircle({ joiningPolicy: "invite_code" });
    const erin = await clientFor("erin");

    const { error: wrong } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: "WRONGCODE",
    });
    expect(wrong).not.toBeNull();
    expect(wrong?.message).toMatch(/invalid invite code/i);

    const { error: missing } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: null,
    });
    expect(missing, "a null code must not pass an invite_code circle").not.toBeNull();

    const { error: right } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: circle.inviteCode,
    });
    expect(right).toBeNull();

    const { data } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(data?.member_count).toBe(2);
  });

  test("request_approval is refused rather than silently treated as open", async () => {
    // circle_join_requests (spec §2.3) is deferred. Failing loudly is the point:
    // a policy value the join path does not understand must never fall through
    // to "allowed".
    const circle = await createCircle({ joiningPolicy: "request_approval" });
    const erin = await clientFor("erin");

    const { error } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/approved request/i);

    const { data } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(data?.member_count).toBe(1);
  });

  test("joining twice is idempotent", async () => {
    const circle = await createCircle({ joiningPolicy: "open" });
    const erin = await clientFor("erin");

    await erin.rpc("join_circle", { p_circle_id: circle.id, p_invite_code: null });
    const { error } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: null,
    });

    // A second call returns success, not an error: a double-clicked Join button
    // wanted the state it already has.
    expect(error).toBeNull();

    const { data } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(data?.member_count, "the member count double-counted a repeat join").toBe(2);
  });

  test("concurrent joins by the same user still produce one membership", async () => {
    const circle = await createCircle({ joiningPolicy: "open" });
    const erin = await clientFor("erin");

    await Promise.all(
      Array.from({ length: 5 }, () =>
        erin.rpc("join_circle", { p_circle_id: circle.id, p_invite_code: null })
      )
    );

    const { data: rows } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("erin"));
    expect(rows ?? []).toHaveLength(1);

    const { data: circleRow } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(circleRow?.member_count).toBe(2);
  });

  test("the member cap holds under concurrent joins", async () => {
    // The reason join_circle takes SELECT … FOR UPDATE before reading
    // member_count. Without the lock every concurrent caller reads the same
    // pre-join count, all pass the cap check, and all insert — the same lost
    // update that let record_referral() mint 500 coins twice (0027).
    const circle = await createCircle({ joiningPolicy: "open" });
    await admin.from("circles").update({ max_members: 3 }).eq("id", circle.id);

    const joiners: UserKey[] = ["alice", "bob", "carol", "dave", "erin"];
    const results = await Promise.all(
      joiners.map(async (key) => {
        const client = await clientFor(key);
        return client.rpc("join_circle", { p_circle_id: circle.id, p_invite_code: null });
      })
    );

    const succeeded = results.filter((r) => r.error === null).length;
    const failed = results.filter((r) => r.error !== null);

    // 1 creator + 2 joiners = the cap of 3.
    expect(succeeded, "more joiners got in than the cap allows").toBe(2);
    expect(failed).toHaveLength(3);
    for (const f of failed) {
      expect(f.error?.message).toMatch(/full/i);
    }

    const { data } = await admin
      .from("circles")
      .select("member_count")
      .eq("id", circle.id)
      .single();
    expect(data?.member_count).toBe(3);

    const { data: rows } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id);
    expect(rows ?? []).toHaveLength(3);
  });

  test("a full circle refuses the next joiner", async () => {
    const circle = await createCircle({ joiningPolicy: "open" });
    await admin.from("circles").update({ max_members: 1 }).eq("id", circle.id);

    const erin = await clientFor("erin");
    const { error } = await erin.rpc("join_circle", {
      p_circle_id: circle.id,
      p_invite_code: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/full/i);
  });

  test("a nonexistent circle id is refused without leaking whether it exists", async () => {
    const erin = await clientFor("erin");
    const { error } = await erin.rpc("join_circle", {
      p_circle_id: "00000000-0000-0000-0000-000000000000",
      p_invite_code: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not found/i);
  });
});

// ─── UI ─────────────────────────────────────────────────────────────────────

test.describe("circles UI", () => {
  test("a member sees their circles; someone in none sees the empty state", async ({
    page,
  }) => {
    await loginAs(page, "alice");
    await page.goto("/circles");
    await expect(page.getByTestId("circle-card").first()).toBeVisible();
    await expect(
      page.locator(`[data-circle-slug="${CIRCLES.x.slug}"]`).first()
    ).toBeVisible();

    await logout(page);
    await loginAs(page, "erin");
    await page.goto("/circles");
    await expect(page.getByTestId("circles-empty")).toBeVisible();
    // Erin is in no circle, but the OPEN one is still discoverable — so the
    // empty state is about membership, not about visibility.
    await expect(page.getByTestId("circles-discoverable")).toBeVisible();
  });

  test("the detail page renders for a member and not-founds for a non-member", async ({
    browser,
  }) => {
    // Two contexts rather than logout-and-back-in on one page, so the outsider's
    // navigation is a genuine first fetch of that URL for its browser.
    const memberContext = await browser.newContext();
    const outsiderContext = await browser.newContext();

    try {
      const memberPage = await memberContext.newPage();
      await loginAs(memberPage, "alice");
      await memberPage.goto(`/circles/${CIRCLES.x.slug}`);
      await expect(memberPage.getByTestId("circle-detail")).toBeVisible();
      await expect(memberPage.getByTestId("circle-members")).toBeVisible();

      const outsiderPage = await outsiderContext.newPage();
      await loginAs(outsiderPage, "bob");
      await outsiderPage.goto(`/circles/${CIRCLES.x.slug}`);

      // Asserting on content, not HTTP status: notFound() streams Next's default
      // 404 page and the dev server returns 200 for the streamed shell. Same
      // reasoning as market-detail.spec.ts:107.
      //
      // Bob gets not-found rather than a "no access" page on purpose —
      // distinguishing private from nonexistent would confirm the circle exists
      // to someone who is not allowed to know that.
      await expect(
        outsiderPage.getByText(/This page could not be found/i)
      ).toBeVisible();
      await expect(outsiderPage.getByTestId("circle-detail")).toHaveCount(0);
    } finally {
      await memberContext.close();
      await outsiderContext.close();
    }
  });

  test("the invite code is shown to a moderator and hidden from a plain member", async ({
    page,
  }) => {
    // The code IS the authorization — find_circle_by_invite_code() treats
    // knowing it as permission to join — so a plain member must not see it.
    await loginAs(page, "mod");
    await page.goto(`/circles/${CIRCLES.x.slug}`);
    await expect(page.getByTestId("circle-invite-code")).toBeVisible();

    await logout(page);
    await loginAs(page, "carol");
    await page.goto(`/circles/${CIRCLES.x.slug}`);
    await expect(page.getByTestId("circle-detail")).toBeVisible();
    await expect(page.getByTestId("circle-invite-row")).toHaveCount(0);
  });

  test("joining by code works end to end", async ({ page }) => {
    const circle = await createCircle({ joiningPolicy: "invite_code" });

    await loginAs(page, "erin");
    await page.goto("/circles");
    await page.getByTestId("join-circle-open").click();
    await page.getByTestId("join-circle-code").fill(circle.inviteCode);
    await page.getByTestId("join-circle-submit").click();

    await page.waitForURL(`**/circles/${circle.slug}`);
    await expect(page.getByTestId("circle-detail")).toBeVisible();

    const { data } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("erin"));
    expect(data ?? []).toHaveLength(1);
  });

  test("a bad code reports an error and joins nothing", async ({ page }) => {
    await loginAs(page, "erin");
    await page.goto("/circles");
    await page.getByTestId("join-circle-open").click();
    await page.getByTestId("join-circle-code").fill("NOSUCHCD");
    await page.getByTestId("join-circle-submit").click();

    await expect(page.getByTestId("join-circle-error")).toBeVisible();
    await expect(page).toHaveURL(/\/circles$/);
  });

  test("a member can leave from the detail page", async ({ page }) => {
    const circle = await createCircle({ members: [{ user: "erin" }] });

    await loginAs(page, "erin");
    await page.goto(`/circles/${circle.slug}`);
    await page.getByTestId("leave-circle-open").click();
    await page.getByTestId("leave-circle-confirm").click();

    await page.waitForURL("**/circles");

    const { data } = await admin
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circle.id)
      .eq("user_id", userId("erin"));
    expect(data ?? []).toEqual([]);
  });

  test("the creator is not offered a Leave button", async ({ page }) => {
    // circle_members_delete protects the creator's row, so the button would be
    // a guaranteed no-op — the classic dead control.
    await loginAs(page, "owner");
    await page.goto(`/circles/${CIRCLES.x.slug}`);
    await expect(page.getByTestId("circle-detail")).toBeVisible();
    await expect(page.getByTestId("leave-circle-open")).toHaveCount(0);
  });

  test("an empty circle list renders the empty state, not an error", async ({ page }) => {
    // The counterpart to the error handling in circles/page.tsx: a legitimately
    // empty read must still render normally. Having just made a failed query
    // throw, this is what stops the fix from over-reaching and turning "you're
    // in no circles" into an error page.
    await loginAs(page, "erin");
    const response = await page.goto("/circles");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("circles-empty")).toBeVisible();
    await expect(
      page.getByText(/Could not load circles/i),
      "an empty result was reported as a failure"
    ).toHaveCount(0);
  });

  test("Circles is reachable from the sidebar", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");
    await page
      .getByTestId("sidebar-nav-secondary")
      .getByRole("link", { name: "Circles" })
      .click();
    await page.waitForURL("**/circles");
    await expect(page.getByTestId("circles-mine")).toBeVisible();
  });
});

test.describe("admin circle creation", () => {
  test("an admin creates a circle and it appears in the listing", async ({ page }) => {
    const slug = `e2e-admin-made-${Date.now()}`;

    await loginAs(page, "admin");
    await page.goto("/admin?tab=circles");

    await page.getByTestId("admin-circle-name").fill("[E2E] Admin Made Circle");
    await page.getByTestId("admin-circle-slug").fill(slug);
    await page.getByTestId("admin-circle-description").fill("Made by the admin form.");
    await page.getByTestId("admin-circle-policy-open").click();
    await page.getByTestId("admin-circle-submit").click();

    await expect(page.locator(`[data-circle-slug="${slug}"]`).first()).toBeVisible({
      timeout: 10_000,
    });

    // The creator's membership row is what create_circle() adds in the same
    // transaction; without it the circle would be invisible to its own creator.
    const { data: circle } = await admin
      .from("circles")
      .select("id, joining_policy")
      .eq("slug", slug)
      .single();
    expect(circle?.joining_policy).toBe("open");

    const { data: members } = await admin
      .from("circle_members")
      .select("user_id, role")
      .eq("circle_id", circle?.id as string);
    expect(members).toEqual([{ user_id: userId("admin"), role: "creator" }]);
  });

  test("the slug is derived from the name and stays editable", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin?tab=circles");

    await page.getByTestId("admin-circle-name").fill("Lincoln High School!");
    await expect(page.getByTestId("admin-circle-slug")).toHaveValue("lincoln-high-school");

    await page.getByTestId("admin-circle-slug").fill("custom-slug");
    await expect(page.getByTestId("admin-circle-slug")).toHaveValue("custom-slug");

    // Once touched, the slug stops tracking the name.
    await page.getByTestId("admin-circle-name").fill("Something Else Entirely");
    await expect(page.getByTestId("admin-circle-slug")).toHaveValue("custom-slug");
  });

  test("a non-admin cannot reach the admin circles tab", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/admin?tab=circles");
    await expect(page.getByTestId("admin-circle-name")).toHaveCount(0);
  });
});

test.describe("create_circle authorization", () => {
  test("an authenticated user cannot call it", async () => {
    // The RPC is SECURITY DEFINER, so without the service_role gate it would
    // hand every user the admin-only creation path it was written to protect.
    const alice = await clientFor("alice");
    const { error } = await alice.rpc("create_circle", {
      p_name: "[E2E] Alice's RPC circle",
      p_slug: "e2e-rpc-alice",
      p_creator_id: userId("alice"),
      p_description: null,
      p_joining_policy: "open",
    });

    expect(error, "an authenticated user reached create_circle").not.toBeNull();

    const { data } = await admin.from("circles").select("id").eq("slug", "e2e-rpc-alice");
    expect(data ?? [], "LEAK: a non-admin created a circle").toEqual([]);
  });
});
