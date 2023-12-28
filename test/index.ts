import { assert } from "chai";
import "dotenv/config";
import "fake-indexeddb/auto";
import { ustore } from "../dist/index.mjs";

const time = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stopwatch = async (label: string, fn: any) => {
  console.log(`${label}:`);
  console.time(label);
  await fn();
  console.timeEnd(label);
};

const mylist = new ustore.Sync<{ slug: string; id: number }>();
mylist.init({
  identifier: "mylist",
  kind: "local",
});

// await stopwatch("indexeddb", async () => {
//   const store1 = new ustore.Sync();
//   await store1.init({ identifier: "store1", kind: "indexeddb" });

//   const store2 = new ustore.Sync();
//   await store2.init({ identifier: "store2", kind: "indexeddb" });

//   const dbs = await indexedDB.databases();
//   const db1 = dbs.find((db) => db.name == "store1");
//   assert.isDefined(db1);
//   const db2 = dbs.find((db) => db.name == "store2");
//   assert.isDefined(db2);

//   for (const entry_db of dbs) {
//     const db = await openDB(entry_db.name!, entry_db.version);
//     const values = await db.getAll(entry_db.name!);
//     assert.strictEqual(values.length, 0);
//   }
// });

await stopwatch("get", async () => {
  assert.isUndefined(mylist.get("rick"));
});

await stopwatch("set", async () => {
  mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(mylist.has("rick"));
  mylist.clear();
});

await stopwatch("has", async () => {
  assert.isFalse(mylist.has("rick"));

  mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(mylist.has("rick"));
});

await stopwatch("expiry", async () => {
  const expiry = 200;

  {
    mylist.set(
      "enola holmes",
      { id: 234, slug: "enola-holmes" },
      { expiry: Date.now() + expiry }
    );

    assert.isTrue(mylist.has("enola holmes"));

    await time(expiry);
    assert.isFalse(mylist.has("enola holmes"));
  }

  {
    mylist.set(
      "enola holmes",
      { id: 234, slug: "enola-holmes" },
      { expiry: Date.now() + expiry }
    );

    assert.isTrue(mylist.has("enola holmes"));

    mylist.update("enola holmes", undefined, {
      expiry: Date.now() + expiry * 2,
    });

    await time(expiry);
    assert.isTrue(mylist.has("enola holmes"));

    await time(expiry * 2);
    assert.isFalse(mylist.has("enola holmes"));
  }
});

await stopwatch("update", async () => {
  let rick = mylist.get("rick");
  assert(rick);

  assert(rick.id == 5473);
  assert(rick.slug == "rick-and-morty");

  mylist.update("rick", { id: 42 });
  rick = mylist.get("rick");
  assert(rick);

  assert.strictEqual(rick.id, 42);
  assert(rick.slug == "rick-and-morty");
});

await stopwatch("rm", async () => {
  assert.isTrue(mylist.has("rick"));
  mylist.rm("rick");
  assert.isFalse(mylist.has("rick"));
});

await stopwatch("update (error)", async () => {
  try {
    mylist.update("rick", { id: 42 });
    assert(0);
  } catch (error) {
    if (error.message != "cannot update non-existing entry") {
      assert(0);
    }
  }
});

await stopwatch("clear", async () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  mylist.clear();
  assert.isFalse(mylist.has("enola"));
  assert.isFalse(mylist.has("rick"));
});

await stopwatch("delete", async () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  mylist.delete();

  if (mylist.kind == "local") {
    try {
      mylist.has("enola");
      assert(0, "Should not succeed");
    } catch (error) {}

    mylist.init({ identifier: "mylist", kind: "local" }).catch(() => {
      assert(0, "Should not fail");
    });
  } else {
    assert.isFalse(mylist.has("enola"));
  }
});

await stopwatch("import, export", async () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  const newstore = new ustore.Sync();
  await newstore.init({ identifier: "newstore", kind: "local" });
  assert((await newstore.length()) == 0);

  await newstore.import(mylist.export());
  // @ts-ignore
  assert.strictEqual(await newstore.length(), 2);
});

await stopwatch("all", async () => {
  const titles = mylist.all();
  assert(titles.length == 2);
  assert(titles[0].slug == "enola-holmes");
  assert(titles[1].slug == "rick-and-morty");
});

await stopwatch("middleware get", async () => {
  {
    const mylist = new ustore.Sync<{ slug: string }>();
    mylist.init({
      identifier: "mylist",
      kind: "local",
      middlewares: {
        get(store, key) {
          return "enola";
        },
      },
    });

    mylist.set("enola", { slug: "enola" });
    assert.strictEqual(mylist.get("rick")?.slug, "enola");
  }

  {
    const mylist = new ustore.Sync<{ slug: string }>();
    mylist.init({
      identifier: "mylist",
      kind: "local",
      middlewares: {
        get(store, key) {
          store.set(key, {
            slug: "dirty_" + store.get(key)!.slug,
          });
          return key;
        },
      },
    });

    mylist.set("enola", { slug: "enola" });
    assert.strictEqual(mylist.get("enola")?.slug, "dirty_enola");
  }
});

await stopwatch("update value and expiry conflicts", async () => {
  const mylist = new ustore.Sync<{ slug: string; id: number }>();
  mylist.init({
    identifier: "mylist",
    kind: "memory",
  });

  mylist.set(
    "title",
    { slug: "enola", id: 2000 },
    { expiry: Date.now() + 24 * 60 * 60 * 1000 }
  );

  function get_and_compare(slug: string, id: number) {
    const entry = mylist.get("title")!;

    assert.isDefined(entry);
    assert.strictEqual(entry.slug, slug);
    assert.strictEqual(entry.id, id);
  }

  get_and_compare("enola", 2000);

  mylist.update("title", {
    slug: "rick",
  });

  get_and_compare("rick", 2000);

  mylist.update(
    "title",
    {
      id: 35,
    },
    {
      expiry: Date.now() + 400,
    }
  );

  get_and_compare("rick", 35);

  await time(400);
  assert.isUndefined(mylist.get("title"));
});

// await stopwatch("queue", async () => {
//   const store = new ustore.Sync<number>();
//   await store.init({ identifier: "numbers", kind: "memory" });

//   store.queue(async () => {
//     await time(400);
//     store.set("1", 1);
//   });
//   store.queue(async () => {
//     store.set("2", 2);
//   });

//   await time(450);

//   let values = await store.all();
//   assert.strictEqual(values[0], 1);
//   assert.strictEqual(values[1], 2);
//   assert.isUndefined(values[2]);
//   assert.isUndefined(values[3]);
//   assert.isUndefined(values[4]);

//   store.queue(async () => {
//     await time(400);
//     await store.set("3", 3);
//   });
//   store.queue(async () => {
//     await time(200);
//     await store.set("4", 4);
//   });
//   store.queue(async () => {
//     await time(600);
//     await store.set("5", 5);
//   });

//   await time(1250);

//   values = await store.all();
//   assert.strictEqual(values[0], 1);
//   assert.strictEqual(values[1], 2);
//   assert.strictEqual(values[2], 3);
//   assert.strictEqual(values[3], 4);
//   assert.strictEqual(values[4], 5);
// });

console.log("Done!");
