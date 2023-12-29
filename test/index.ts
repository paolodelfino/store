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

const mylist = new ustore.Sync<{ slug: string; id: number }>({
  identifier: "mylist",
  kind: "local",
});

const amylist = new ustore.Async<{ slug: string; id: number }>();
await amylist.init({
  type: "object",
  identifier: "mylist",
});

// {
//   await amylist.set("234", { id: 234, slug: "enola-holmes" });
//   await amylist.set("42", { id: 42, slug: "rick-and-morty" });
//   await amylist.debug();

//   // console.log(await amylist.has("42"));
//   // console.log(await amylist.has("234"));

//   const db = await openDB("mylist");
//   const table = db.transaction("mylist").store;
//   let cursor = await table.openCursor();

//   console.log("CURSOR");
//   while (cursor) {
//     if (cursor.key.toString() == "42") {
//       console.log("found");
//       break;
//     }

//     const sep = cursor.value.indexOf("-");
//     const noptions = Number(cursor.value.slice(0, sep));
//     const nprops = Number(cursor.value.slice(sep + 1));

//     cursor = await cursor.advance(noptions + nprops + 1);
//   }
// }
// exit(0);

await stopwatch("clear (async)", async () => {
  await amylist.set("234", { id: 234, slug: "enola-holmes" });
  assert.isTrue(await amylist.has("234"));

  await amylist.debug();

  await amylist.set("rick", { id: 42, slug: "rick-and-morty" });
  await amylist.debug();
  assert.isTrue(await amylist.has("rick"));

  await amylist.clear();
  assert.isFalse(await amylist.has("enola"));
  assert.isFalse(await amylist.has("rick"));
});

await stopwatch("set (async)", async () => {
  await amylist.set("rick", { id: 5473, slug: "rick-and-morty" });
  assert.isTrue(await amylist.has("rick"));

  await amylist
    .set("rick", { id: 5473, slug: "rick-and-morty" })
    .then(() => assert(0, "Should not succeed"))
    .catch((err) => {
      assert.strictEqual(
        err.message,
        'cannot set a value of a pre-existing key: "rick"'
      );
    });

  await amylist.clear();
});

await stopwatch("has (async)", async () => {
  assert.isFalse(await amylist.has("rick"));

  await amylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(await amylist.has("rick"));

  await amylist.clear();
});

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

    // try {
    //   mylist.init({ identifier: "mylist", kind: "local" });
    // } catch (error) {
    //   assert(0, "Should not fail");
    // }
  } else {
    assert.isFalse(mylist.has("enola"));
  }
});

await stopwatch("import, export", async () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  const newstore = new ustore.Sync({ identifier: "newstore", kind: "local" });
  assert(newstore.length == 0);

  newstore.import(mylist.export());
  // @ts-ignore
  assert.strictEqual(newstore.length, 2);
});

await stopwatch("all", async () => {
  const titles = mylist.values();
  assert(titles.length == 2);
  assert(titles[0].slug == "enola-holmes");
  assert(titles[1].slug == "rick-and-morty");
});

await stopwatch("middleware get", async () => {
  {
    const mylist = new ustore.Sync<{ slug: string }>({
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
    const mylist = new ustore.Sync<{ slug: string }>({
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

await stopwatch("update both value & options", async () => {
  const mylist = new ustore.Sync<{ slug: string; id: number }>({
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
