import { assert } from "chai";
import "dotenv/config";
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

await stopwatch("get", () => {
  assert(!mylist.get("rick"));
});

await stopwatch("set", () => {
  mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(mylist.has("rick"));
  mylist.clear();
});

await stopwatch("has", () => {
  assert.isFalse(mylist.has("rick"));

  mylist.set("rick", { id: 5473, slug: "rick-and-morty" });

  assert.isTrue(mylist.has("rick"));
});

await stopwatch("expiry", async () => {
  const expiry = 200;

  mylist.set(
    "enola holmes",
    { id: 234, slug: "enola-holmes" },
    { expiry: Date.now() + expiry }
  );

  assert.isTrue(mylist.has("enola holmes"));

  await time(expiry);
  assert.isFalse(mylist.has("enola holmes"));
});

await stopwatch("update", () => {
  let rick = mylist.get("rick");
  assert(rick);

  assert(rick.id == 5473);
  assert(rick.slug == "rick-and-morty");

  mylist.update("rick", { id: 42 });
  rick = mylist.get("rick");
  assert(rick);

  assert(rick.id == 42);
  assert(rick.slug == "rick-and-morty");
});

await stopwatch("rm", () => {
  assert.isTrue(mylist.has("rick"));
  mylist.rm("rick");
  assert.isFalse(mylist.has("rick"));
});

await stopwatch("update (error)", () => {
  try {
    mylist.update("rick", { id: 42 });
    assert(0);
  } catch (error) {
    if (error.message != "cannot update non-existing entry") {
      assert(0);
    }
  }
});

await stopwatch("clear", () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  mylist.clear();
  assert.isFalse(mylist.has("enola"));
  assert.isFalse(mylist.has("rick"));
});

await stopwatch("delete", () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  mylist.delete();
  assert.isFalse(mylist.has("enola"));
  assert.isFalse(mylist.has("rick"));
});

await stopwatch("import, export", () => {
  mylist.set("enola", { id: 234, slug: "enola-holmes" });
  assert.isTrue(mylist.has("enola"));

  mylist.set("rick", { id: 42, slug: "rick-and-morty" });
  assert.isTrue(mylist.has("rick"));

  const newstore = new UStore({ identifier: "newstore", kind: "memory" });
  assert(newstore.length == 0);

  newstore.import(mylist.export());
  // @ts-ignore
  assert(newstore.length == 2);
});

await stopwatch("all", () => {
  const titles = mylist.all;
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
        get(store, key) {
          return "enola";
        },
      },
    });

    mylist.set("enola", { slug: "enola" });
    assert.strictEqual(mylist.get("rick")?.slug, "enola");
  }

  {
    const mylist = new UStore<{ slug: string }>({
      identifier: "mylist",
      kind: "memory",
      middlewares: {
        get(store, key) {
          store.set(key, { slug: "dirty_" + store.get(key)!.slug });
          return key;
        },
      },
    });

    mylist.set("enola", { slug: "enola" });
    assert.strictEqual(mylist.get("enola")?.slug, "dirty_enola");
  }
});

console.log("Done!");
