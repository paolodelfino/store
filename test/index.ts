import { assert } from "chai";
import "dotenv/config";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { UStore } from "../dist/index.mjs";

const time = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stopwatch = async (label: string, fn: any) => {
  console.log(`${label}:`);
  console.time(label);
  await fn();
  console.timeEnd(label);
};

const mylist = new UStore<{ slug: string; id: number }>();
await mylist.init({
  identifier: "mylist",
  kind: "indexeddb",
});

await stopwatch("indexeddb", async () => {
  const store1 = new UStore();
  await store1.init({ identifier: "store1", kind: "indexeddb" });

  const store2 = new UStore();
  await store2.init({ identifier: "store2", kind: "indexeddb" });

  const dbs = await indexedDB.databases();
  const db1 = dbs.find((db) => db.name == "store1");
  assert.isDefined(db1);
  const db2 = dbs.find((db) => db.name == "store2");
  assert.isDefined(db2);

  for (const entry_db of dbs) {
    const db = await openDB(entry_db.name!, entry_db.version);
    const values = await db.getAll(entry_db.name!);
    assert.strictEqual(values.length, 0);
  }
});

await stopwatch("get", async () => {
  assert.isNull(await mylist.get("rick"));
});

await stopwatch("set", async () => {
  await mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(await mylist.has("rick"));
  await mylist.clear();
});

await stopwatch("has", async () => {
  assert.isFalse(await mylist.has("rick"));

  await mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(await mylist.has("rick"));
});

await stopwatch("expiry", async () => {
  const expiry = 200;

  {
    await mylist.set(
      "enola holmes",
      { id: 234, slug: "enola-holmes" },
      { expiry: Date.now() + expiry }
    );

    assert.isTrue(await mylist.has("enola holmes"));

    await time(expiry);
    assert.isFalse(await mylist.has("enola holmes"));
  }

  {
    await mylist.set(
      "enola holmes",
      { id: 234, slug: "enola-holmes" },
      { expiry: Date.now() + expiry }
    );

    assert.isTrue(await mylist.has("enola holmes"));

    await mylist.update("enola holmes", undefined, {
      expiry: Date.now() + expiry * 2,
    });

    await time(expiry);
    assert.isTrue(await mylist.has("enola holmes"));

    await time(expiry * 2);
    assert.isFalse(await mylist.has("enola holmes"));
  }
});

await stopwatch("update", async () => {
  let rick = await mylist.get("rick");
  assert(rick);

  assert(rick.id == 5473);
  assert(rick.slug == "rick-and-morty");

  await mylist.update("rick", { id: 42 });
  rick = await mylist.get("rick");
  assert(rick);

  assert.strictEqual(rick.id, 42);
  assert(rick.slug == "rick-and-morty");
});

await stopwatch("rm", async () => {
  assert.isTrue(await mylist.has("rick"));
  await mylist.rm("rick");
  assert.isFalse(await mylist.has("rick"));
});

await stopwatch("update (error)", async () => {
  try {
    await mylist.update("rick", { id: 42 });
    assert(0);
  } catch (error) {
    if (error.message != "cannot update non-existing entry") {
      assert(0);
    }
  }
});

await stopwatch("clear", async () => {
  await mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(await mylist.has("enola"));

  await mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(await mylist.has("rick"));

  await mylist.clear();
  assert.isFalse(await mylist.has("enola"));
  assert.isFalse(await mylist.has("rick"));
});

await stopwatch("delete", async () => {
  await mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(await mylist.has("enola"));

  await mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(await mylist.has("rick"));

  await mylist.delete();

  if (mylist.kind == "indexeddb") {
    await mylist
      .has("enola")
      .then(() => {
        assert(0, "Should not succeed");
      })
      .catch(() => {});

    await mylist.init({ identifier: "mylist", kind: "indexeddb" }).catch(() => {
      assert(0, "Should not fail");
    });
  } else {
    assert.isFalse(await mylist.has("enola"));
  }
});

await stopwatch("import, export", async () => {
  await mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(await mylist.has("enola"));

  await mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(await mylist.has("rick"));

  const newstore = new UStore();
  await newstore.init({ identifier: "newstore", kind: "indexeddb" });
  assert((await newstore.length()) == 0);

  await newstore.import(await mylist.export());
  // @ts-ignore
  assert.strictEqual(await newstore.length(), 2);
});

await stopwatch("all", async () => {
  const titles = await mylist.all();
  assert(titles.length == 2);
  assert(titles[0].slug == "enola-holmes");
  assert(titles[1].slug == "rick-and-morty");
});

await stopwatch("middleware get", async () => {
  {
    const mylist = new UStore<{ slug: string }>();
    await mylist.init({
      identifier: "mylist",
      kind: "indexeddb",
      middlewares: {
        async get(store, key) {
          return "enola";
        },
      },
    });

    await mylist.set("enola", { slug: "enola" });
    assert.strictEqual((await mylist.get("rick"))?.slug, "enola");
  }

  {
    const mylist = new UStore<{ slug: string }>();
    await mylist.init({
      identifier: "mylist",
      kind: "indexeddb",
      middlewares: {
        async get(store, key) {
          await store.set(key, {
            slug: "dirty_" + (await store.get(key))!.slug,
          });
          return key;
        },
      },
    });

    await mylist.set("enola", { slug: "enola" });
    assert.strictEqual((await mylist.get("enola"))?.slug, "dirty_enola");
  }
});

await stopwatch("update value and expiry conflicts", async () => {
  const mylist = new UStore<{ slug: string; id: number }>();
  await mylist.init({
    identifier: "mylist",
    kind: "memory",
  });

  await mylist.set(
    "title",
    { slug: "enola", id: 2000 },
    { expiry: Date.now() + 24 * 60 * 60 * 1000 }
  );

  async function get_and_compare(slug: string, id: number) {
    const entry = (await mylist.get("title"))!;

    assert.isNotNull(entry);
    assert.strictEqual(entry.slug, slug);
    assert.strictEqual(entry.id, id);
  }

  await get_and_compare("enola", 2000);

  await mylist.update("title", {
    slug: "rick",
  });

  await get_and_compare("rick", 2000);

  await mylist.update(
    "title",
    {
      id: 35,
    },
    {
      expiry: Date.now() + 400,
    }
  );

  await get_and_compare("rick", 35);

  await time(400);
  assert.isNull(await mylist.get("title"));
});

console.log("Done!");
