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
  mylist.set("rick", {
    value: { id: 5473, slug: "rick-and-morty" },
  });

  assert(mylist.get("rick"));
});

await stopwatch("expiry", async () => {
  const expiry = 200;

  mylist.set("enola holmes", {
    value: { id: 234, slug: "enola-holmes" },
    expiry: Date.now() + 1 * expiry,
  });

  assert(mylist.get("enola holmes"));

  await time(expiry);
  assert(!mylist.get("enola holmes"));
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
  assert(mylist.get("rick"));
  mylist.rm("rick");
  assert(!mylist.get("rick"));
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
  mylist.set("enola", {
    value: { id: 234, slug: "enola-holmes" },
  });
  assert(mylist.get("enola"));

  mylist.set("rick", {
    value: { id: 42, slug: "rick-and-morty" },
  });
  assert(mylist.get("rick"));

  mylist.clear();
  assert(!mylist.get("enola"));
  assert(!mylist.get("rick"));
});

await stopwatch("delete", () => {
  mylist.set("enola", {
    value: { id: 234, slug: "enola-holmes" },
  });
  assert(mylist.get("enola"));

  mylist.set("rick", {
    value: { id: 42, slug: "rick-and-morty" },
  });
  assert(mylist.get("rick"));

  mylist.clear();
  assert(!mylist.get("enola"));
  assert(!mylist.get("rick"));
});

await stopwatch("import, export", () => {
  mylist.set("enola", {
    value: { id: 234, slug: "enola-holmes" },
  });
  assert(mylist.get("enola"));

  mylist.set("rick", {
    value: { id: 42, slug: "rick-and-morty" },
  });
  assert(mylist.get("rick"));

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

console.log("Done!");
