import { assert } from "chai";
import "dotenv/config";
import "fake-indexeddb/auto";
import { UStore } from "../dist/index.mjs";

const time = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stopwatch = async (label: string, fn: any) => {
  console.log(`${label}:`);
  console.time(label);
  await fn();
  console.timeEnd(label);
};

const mylist = new UStore<{ slug: string; id: number }>({
  identifier: "mylist",
  kind: "memory",
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

  await mylist.set(
    "enola holmes",
    { id: 234, slug: "enola-holmes" },
    { expiry: Date.now() + expiry }
  );

  assert.isTrue(await mylist.has("enola holmes"));

  await time(expiry);
  assert.isFalse(await mylist.has("enola holmes"));
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
  assert.isFalse(await mylist.has("enola"));
  assert.isFalse(await mylist.has("rick"));
});

await stopwatch("import, export", async () => {
  await mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(await mylist.has("enola"));

  await mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(await mylist.has("rick"));

  const newstore = new UStore({ identifier: "newstore", kind: "memory" });
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
    const mylist = new UStore<{ slug: string }>({
      identifier: "mylist",
      kind: "memory",
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
    const mylist = new UStore<{ slug: string }>({
      identifier: "mylist",
      kind: "memory",
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

console.log("Done!");
