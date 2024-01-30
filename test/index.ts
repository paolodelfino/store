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

globalThis["listeners"] = [];

class BroadcastChannel {
  constructor(name: string) {}

  postMessage(message: any) {
    for (const cb of globalThis["listeners"]) {
      cb({ data: message });
    }
  }

  addEventListener(type: "message", listener: (ev: { data: any }) => any) {
    globalThis["listeners"].push(listener);
  }

  close() {}
}
// @ts-ignore
globalThis.BroadcastChannel = BroadcastChannel;

{
  const mylist = new ustore.Sync<{ slug: string; id: number }>("mylist", {
    kind: "local",
  });

  await stopwatch("get", async () => {
    assert.isUndefined(mylist.get("rick"));

    mylist.set("rick", { id: 5473, slug: "rick-and-morty" });
    const rick = mylist.get("rick")!;
    assert.isDefined(rick);

    assert.strictEqual(rick.id, 5473);
    assert.strictEqual(rick.slug, "rick-and-morty");
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

    assert(rick.id === 5473);
    assert(rick.slug === "rick-and-morty");

    mylist.update("rick", { id: 42 });
    rick = mylist.get("rick");
    assert(rick);

    assert.strictEqual(rick.id, 42);
    assert(rick.slug === "rick-and-morty");
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

    if (mylist.kind === "local") {
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

    const newstore = new ustore.Sync("newstore", { kind: "local" });
    assert(newstore.length === 0);

    newstore.import(mylist.export());
    // @ts-ignore
    assert.strictEqual(newstore.length, 2);
  });

  await stopwatch("values", async () => {
    const titles = mylist.values();
    assert(titles.length === 2);
    assert(titles[0].slug === "enola-holmes");
    assert(titles[1].slug === "rick-and-morty");
  });

  await stopwatch("middleware get", async () => {
    {
      const mylist = new ustore.Sync<{ slug: string }>("mylist", {
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
      const mylist = new ustore.Sync<{ slug: string }>("mylist", {
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
    const mylist = new ustore.Sync<{ slug: string; id: number }>("mylist", {
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
}

{
  let mylist = new ustore.Async<{
    slug: string;
    id: number;
  }>();
  await mylist.init("mylist");

  let history = new ustore.Async<string>();
  await history.init("history");

  await stopwatch("clear (async)", async () => {
    {
      await mylist.set({ id: 234, slug: "enola-holmes" }, 234);
      assert.isTrue(await mylist.has(234));

      await mylist.set({ id: 42, slug: "rick-and-morty" }, 42);
      assert.isTrue(await mylist.has(42));

      await mylist.clear();
      assert.isFalse(await mylist.has(234));
      assert.isFalse(await mylist.has(42));
    }

    {
      await history.set("enola", "enola");
      assert.isTrue(await history.has("enola"));

      await history.set("rick", "rick");
      assert.isTrue(await history.has("rick"));

      await history.clear();
      assert.isFalse(await history.has("enola"));
      assert.isFalse(await history.has("rick"));
    }
  });

  await stopwatch("set (async)", async () => {
    {
      assert.strictEqual(
        await mylist.set({ id: 5473, slug: "rick-and-morty" }, 5473),
        5473
      );
      assert.strictEqual((await mylist.get(5473))!.id, 5473);
      assert.strictEqual((await mylist.get(5473))!.slug, "rick-and-morty");

      assert.strictEqual(
        await mylist.set({ id: 2000, slug: "rick" }, 5473),
        5473
      );
      assert.strictEqual((await mylist.get(5473))!.id, 2000);
      assert.strictEqual((await mylist.get(5473))!.slug, "rick");

      await mylist.clear();
    }

    {
      assert.strictEqual(await history.set("enola", "enola"), "enola");
      assert.strictEqual(await history.get("enola"), "enola");

      assert.strictEqual(await history.set("enola holmes", "enola"), "enola");
      assert.strictEqual(await history.get("enola"), "enola holmes");

      await history.clear();
    }
  });

  await stopwatch("has (async)", async () => {
    {
      assert.isFalse(await mylist.has("rick"));

      await mylist.set({ id: 5473, slug: "rick-and-morty" }, "rick");

      assert.isTrue(await mylist.has("rick"));

      await mylist.clear();
    }

    {
      assert.isFalse(await history.has("rick"));

      await history.set("rick", "rick");

      assert.isTrue(await history.has("rick"));

      await history.clear();
    }
  });

  await stopwatch("get (async)", async () => {
    {
      assert.isUndefined(await mylist.get(5473));

      await mylist.set({ id: 5473, slug: "rick-and-morty" }, 5473);
      const rick = (await mylist.get(5473))!;
      assert.isDefined(rick);

      assert.strictEqual(rick.id, 5473);
      assert.strictEqual(rick.slug, "rick-and-morty");

      await mylist.clear();
    }

    {
      assert.isUndefined(await history.get("rick"));

      await history.set("rick", "rick");
      const rick = (await history.get("rick"))!;
      assert.isDefined(rick);

      assert.strictEqual(rick, "rick");

      await history.clear();
    }
  });

  await stopwatch("get_some (async)", async () => {
    {
      assert.strictEqual((await mylist.get_some([5473, 100])).length, 0);

      await mylist.set({ id: 5473, slug: "rick-and-morty" }, 5473);
      await mylist.set({ id: 100, slug: "enola-holmes" }, 100);

      const some = await mylist.get_some([5473, 100]);
      assert.strictEqual(some.length, 2);

      assert.strictEqual(some[0].id, 5473);
      assert.strictEqual(some[0].slug, "rick-and-morty");

      assert.strictEqual(some[1].id, 100);
      assert.strictEqual(some[1].slug, "enola-holmes");

      await mylist.clear();
    }

    {
      assert.strictEqual((await history.get_some(["rick", "enola"])).length, 0);

      await history.set("rick", "rick");
      await history.set("enola", "enola");

      const some = await history.get_some(["rick", "enola"]);
      assert.strictEqual(some.length, 2);

      assert.strictEqual(some[0], "rick");

      assert.strictEqual(some[1], "enola");

      await history.clear();
    }
  });

  await stopwatch("update (async)", async () => {
    {
      await mylist
        .update(100, { value: { slug: "rick" } })
        .then(() => assert(0, "Should not succeed"))
        .catch((err) => {
          assert.strictEqual(
            err.message,
            'cannot update non-existing entry: (number) "100"'
          );
        });

      await mylist.set({ slug: "enola", id: 100 }, 100, {
        expiry: Date.now() + 2000,
      });
      let enola = (await mylist.get(100))!;
      assert.strictEqual(enola.slug, "enola");

      await mylist.update(100, async (old) => {
        assert.strictEqual(old.value.id, 100);
        assert.strictEqual(old.value.slug, "enola");

        return { value: { slug: "enola-holmes-2" } };
      });
      enola = (await mylist.get(100))!;
      assert.strictEqual(enola.slug, "enola-holmes-2");
      assert.strictEqual(enola.id, 100);

      await mylist.update(100, {
        value: { slug: "enola-holmes" },
        options: { expiry: Date.now() + 200 },
      });
      enola = (await mylist.get(100))!;
      assert.strictEqual(enola.slug, "enola-holmes");
      assert.strictEqual(enola.id, 100);

      await time(200);
      assert.isFalse(await mylist.has(100));

      await mylist.clear();
    }

    {
      await history
        .update("enola", { value: "enola" })
        .then(() => assert(0, "Should not succeed"))
        .catch((err) => {
          assert.strictEqual(
            err.message,
            'cannot update non-existing entry: (string) "enola"'
          );
        });

      await history.set("enola", "enola", { expiry: Date.now() + 2000 });
      let enola = (await history.get("enola"))!;
      assert.strictEqual(enola, "enola");

      await history.update("enola", {
        value: "enola-holmes",
        options: {
          expiry: Date.now() + 200,
        },
      });
      enola = (await history.get("enola"))!;
      assert.strictEqual(enola, "enola-holmes");

      await time(200);
      assert.isFalse(await mylist.has("enola"));

      await history.clear();
    }
  });

  await stopwatch("middleware get (async)", async () => {
    {
      {
        const mylist = new ustore.Async<{ slug: string }>();
        await mylist.init("middleware-mylist", {
          middlewares: {
            async get(store, key) {
              // To test there's no circular dependency
              await store.get(key);

              return "enola";
            },
          },
        });

        await mylist.set({ slug: "enola" }, "enola");
        const fakerick = (await mylist.get("rick"))!;
        assert.isDefined(fakerick);
        assert.strictEqual(fakerick.slug, "enola");

        await mylist.clear();
      }

      {
        const mylist = new ustore.Async<{ slug: string }>();
        await mylist.init("middleware-mylist", {
          middlewares: {
            async get(store, key) {
              const entry = (await store.get(key))!;
              assert.isDefined(entry);

              await store.update(key, {
                value: {
                  slug: "dirty_" + entry.slug,
                },
              });

              return key;
            },
          },
        });

        await mylist.set({ slug: "enola" }, "enola");
        assert.strictEqual((await mylist.get("enola"))!.slug, "dirty_enola");

        await mylist.clear();
      }
    }

    {
      {
        const history = new ustore.Async<string>();
        await history.init("middleware-history", {
          middlewares: {
            async get(store, key) {
              // To test there's no circular dependency
              await store.get(key);

              return "enola";
            },
          },
        });

        await history.set("enola", "enola");
        const fakerick = (await history.get("rick"))!;
        assert.isDefined(fakerick);
        assert.strictEqual(fakerick, "enola");

        await history.clear();
      }

      {
        const history = new ustore.Async<string>();
        await history.init("middleware-history", {
          middlewares: {
            async get(store, key) {
              const entry = (await store.get(key))!;
              assert.isDefined(entry);

              await store.update(key, {
                value: "dirty_" + entry,
              });

              return key;
            },
          },
        });

        await history.set("enola", "enola");
        assert.strictEqual((await history.get("enola"))!, "dirty_enola");

        await history.clear();
      }
    }
  });

  await stopwatch("rm (async)", async () => {
    {
      await mylist.set({ slug: "enola", id: 100 }, 100);
      assert.isTrue(await mylist.has(100));

      await mylist.rm(100);
      assert.isUndefined(await mylist.get(100));

      await mylist.clear();
    }

    {
      await history.set("enola", "enola");
      assert.isTrue(await history.has("enola"));

      await history.rm("enola");
      assert.isUndefined(await history.get("enola"));

      await history.clear();
    }
  });

  await stopwatch("delete (async)", async () => {
    {
      assert.isDefined(
        (await indexedDB.databases()).find((db) => db.name === "mylist")
      );

      await mylist.delete();

      assert.isUndefined(
        (await indexedDB.databases()).find((db) => db.name === "mylist")
      );

      mylist = new ustore.Async<{ slug: string; id: number }>();
      await mylist.init("mylist");
    }

    {
      assert.isDefined(
        (await indexedDB.databases()).find((db) => db.name === "history")
      );

      await history.delete();

      assert.isUndefined(
        (await indexedDB.databases()).find((db) => db.name === "history")
      );

      history = new ustore.Async<string>();
      await history.init("history");
    }
  });

  await stopwatch("length (async)", async () => {
    {
      assert.strictEqual(await mylist.length(), 0);

      await mylist.set({ slug: "enola-holmes", id: 100 }, 100);

      assert.strictEqual(await mylist.length(), 1);

      await mylist.clear();
    }

    {
      assert.strictEqual(await history.length(), 0);

      await history.set("enola", "enola");

      assert.strictEqual(await history.length(), 1);

      await history.clear();
    }
  });

  await stopwatch("import, export (async)", async () => {
    {
      await mylist.set({ id: 234, slug: "enola-holmes" }, 234);
      await mylist.set({ id: 42, slug: "rick-and-morty" }, 42);

      const newstore = new ustore.Async<{
        slug: string;
        id: number;
      }>();
      await newstore.init("newstore");

      {
        assert.strictEqual(await newstore.length(), 0);
        await newstore.import(await mylist.export());
        assert.strictEqual(await newstore.length(), 2);
      }

      {
        await newstore.rm(234);
        await newstore.update(42, {
          value: { id: 40 },
        });
        await newstore.set({ id: 100, slug: "few" }, 100);

        assert.strictEqual(await newstore.length(), 2);

        assert.strictEqual((await mylist.get(42))?.id, 42);

        assert.strictEqual(await mylist.length(), 2);
        await mylist.import(await newstore.export(), true);
        assert.strictEqual(await mylist.length(), 3);

        assert.isTrue(await mylist.has(234));
        assert.strictEqual((await mylist.get(42))?.id, 40);
        assert.isTrue(await mylist.has(100));
      }

      await mylist.clear();
      await newstore.clear();
    }

    {
      await history.set("enola", "enola");
      await history.set("rick", "rick");

      const newstore = new ustore.Async<string>();
      await newstore.init("newstore");

      {
        assert.strictEqual(await newstore.length(), 0);
        await newstore.import(await history.export());
        assert.strictEqual(await newstore.length(), 2);
      }

      {
        await newstore.rm("enola");
        await newstore.update("rick", { value: "rick and morty" });
        await newstore.set("few", "few");

        assert.strictEqual(await newstore.length(), 2);

        assert.strictEqual(await history.get("rick"), "rick");

        assert.strictEqual(await history.length(), 2);
        await history.import(await newstore.export(), true);
        assert.strictEqual(await history.length(), 3);

        assert.isTrue(await history.has("enola"));
        assert.strictEqual(await history.get("rick"), "rick and morty");
        assert.isTrue(await history.has("few"));
      }

      await history.clear();
      await newstore.clear();
    }
  });

  await stopwatch("values (async)", async () => {
    {
      await mylist.set({ id: 234, slug: "enola-holmes" }, 234);
      await mylist.set({ id: 42, slug: "rick-and-morty" }, 42);

      const entries = await mylist.values();
      assert.strictEqual(entries.length, 2);

      assert.isDefined(
        entries.find((e) => e.value.slug === "enola-holmes" && e.key === 234)
      );
      assert.isDefined(
        entries.find((e) => e.value.slug === "rick-and-morty" && e.key === 42)
      );

      await mylist.clear();
    }

    {
      await history.set("enola", "enola");
      await history.set("rick", "rick");

      const entries = await history.values();
      assert.strictEqual(entries.length, 2);
      assert.isDefined(
        entries.find((e) => e.value === "enola" && e.key === "enola")
      );
      assert.isDefined(
        entries.find((e) => e.value === "rick" && e.key === "rick")
      );

      await history.clear();
    }
  });

  await stopwatch("expiry (async)", async () => {
    {
      await mylist.set({ id: 234, slug: "enola-holmes" }, 234, {
        expiry: Date.now() + 200,
      });

      assert.isTrue(await mylist.has(234));

      await time(200);
      assert.isFalse(await mylist.has(234));
    }

    {
      await history.set("enola", "enola", { expiry: Date.now() + 200 });

      assert.isTrue(await history.has("enola"));

      await time(200);
      assert.isFalse(await history.has("enola"));
    }
  });

  await stopwatch("orders (async)", async () => {
    {
      const store = new ustore.Async<
        {
          id: number;
          slug: string;
        },
        "bySlug"
      >();
      await store.init("store", {
        autoincrement: true,
        indexes: [
          {
            name: "bySlug",
            path: "slug",
            unique: true,
          },
        ],
      });

      for (let i = 0; i < 100; ++i) {
        await store.set({
          id: i,
          slug: `${i}`,
        });
        await time(1);
      }

      {
        const values = await store.values();
        for (let i = 0; i < 100; ++i) {
          assert.strictEqual(values[i].value.id, i);
        }

        const reverse = await store.values(true);
        for (let i = 0; i < 100; ++i) {
          assert.strictEqual(reverse[i].value.id, 99 - i);
        }
      }

      {
        const index = await store.index("bySlug");
        for (let i = 0; i < 100; ++i) {
          assert.strictEqual(index[i].value.id, i);
        }

        const reverse = await store.index("bySlug", { reverse: true });
        for (let i = 0; i < 100; ++i) {
          assert.strictEqual(reverse[i].value.id, 99 - i);
        }
      }

      {
        const page = await store.page(1);
        for (let i = 0; i < 3; ++i) {
          assert.strictEqual(page.results[i].value.id, i);
        }
        assert.isTrue(page.has_next);

        const reverse = await store.page(1, true);
        for (let i = 0; i < 3; ++i) {
          assert.strictEqual(reverse.results[i].value.id, 99 - i);
        }
        assert.isTrue(reverse.has_next);
      }

      await store.delete();
    }
  });

  await stopwatch("migration & indexes (async)", async () => {
    {
      const store = new ustore.Async<
        {
          id: {
            slug?: string;
            number: number;
          };
          genres: ("horror" | "fantasy" | "series")[];
        },
        "byGenre" | "byIdNumber" | "bySlug"
      >();
      await store.init("store", {
        indexes: [
          {
            name: "byGenre",
            path: "genres",
            multi_entry: true,
          },
          {
            name: "byIdNumber",
            path: "id.number",
            unique: true,
          },
          {
            name: "bySlug",
            path: "id.slug",
          },
        ],
        async migrate({ old_version }) {
          assert.strictEqual(old_version, 0);
        },
      });

      await store.set(
        {
          id: { number: 15 },
          genres: ["horror"],
        },
        "15"
      );
      await store.set(
        {
          id: { number: 17, slug: "rick" },
          genres: ["series", "fantasy"],
        },
        "17"
      );
      await store.set({ id: { number: 20 }, genres: [] }, "20");
      await store.set(
        {
          id: { number: 16 },
          genres: ["series"],
        },
        "16"
      );

      assert.strictEqual((await store.index("bySlug")).length, 1);
      assert.strictEqual((await store.index("byIdNumber")).length, 4);

      assert.strictEqual(
        (
          await store.index("byGenre", {
            mode: "only",
            value: "fantasy",
          })
        ).length,
        1
      );
      assert.strictEqual(
        (
          await store.index("byGenre", {
            mode: "only",
            value: "horror",
          })
        ).length,
        1
      );
      assert.strictEqual(
        (
          await store.index("byGenre", {
            mode: "only",
            value: "series",
          })
        ).length,
        2
      );

      assert.strictEqual(
        (
          await store.index("byIdNumber", {
            mode: "above",
            value: 17,
          })
        ).length,
        1
      );
      assert.strictEqual(
        (
          await store.index("byIdNumber", {
            mode: "above",
            value: 17,
            inclusive: true,
          })
        ).length,
        2
      );

      assert.strictEqual(
        (
          await store.index("byIdNumber", {
            mode: "below",
            value: 17,
          })
        ).length,
        2
      );
      assert.strictEqual(
        (
          await store.index("byIdNumber", {
            mode: "below",
            value: 17,
            inclusive: true,
          })
        ).length,
        3
      );

      const c = await store.index("byIdNumber", {
        mode: "range",
        lower_value: 16,
        upper_value: 20,
      });
      assert.strictEqual(c.length, 1);
      assert.strictEqual(c[0].value.id.number, 17);
      const a = await store.index("byIdNumber", {
        mode: "range",
        lower_value: 16,
        upper_value: 20,
        lower_inclusive: true,
      });
      assert.strictEqual(a.length, 2);
      assert.isDefined(
        a.find((i) => i.value.id.number === 16 && i.key === "16")
      );
      assert.isDefined(
        a.find((i) => i.value.id.number === 17 && i.key === "17")
      );
      const b = await store.index("byIdNumber", {
        mode: "range",
        lower_value: 16,
        upper_value: 20,
        upper_inclusive: true,
      });
      assert.strictEqual(b.length, 2);
      assert.isDefined(
        b.find((i) => i.value.id.number === 17 && i.key === "17")
      );
      assert.isDefined(
        b.find((i) => i.value.id.number === 20 && i.key === "20")
      );

      store.close();
    }

    {
      const store = new ustore.Async<
        {
          id: {
            slug?: string;
            number: number;
          };
          genres: ("horror" | "fantasy" | "series")[];
          vote: number;
        },
        "byGenre" | "byIdNumber" | "byVote"
      >();
      await store.init("store", {
        version: 2,
        indexes: [
          {
            name: "byGenre",
            path: "genres",
            multi_entry: true,
          },
          {
            name: "byIdNumber",
            path: "id.number",
            unique: true,
          },
          {
            name: "byVote",
            path: "vote",
          },
        ],
        async migrate({ old_version, remove_index }) {
          assert.strictEqual(old_version, 1);

          remove_index("bySlug");

          (await store.values()).map((entry) => {
            assert.isUndefined(entry.value.vote);

            store.update(`${entry.value.id.number}`, { value: { vote: 0 } });
          });
        },
      });

      const indexes = store.indexes();
      assert.strictEqual(indexes.length, 3);
      // @ts-ignore
      assert.isUndefined(indexes.find((index) => index === "bySlug"));

      (await store.values()).map((entry) => {
        assert.strictEqual(entry.value.vote, 0);
      });

      await store.update("15", {
        value: {
          vote: 10,
        },
      });
      await store.update("17", {
        value: {
          vote: 8,
        },
      });
      await store.update("20", { value: { vote: 2 } });
      await store.update("16", {
        value: {
          vote: 5,
        },
      });

      await store.delete();
    }

    {
      try {
        const store = new ustore.Async();
        await store.init("store");

        await store.set("enola", "enola");

        await store.delete();
      } catch (error) {
        assert(0, "Should not fail");
      }
    }
  });

  await stopwatch("consume (async)", async () => {
    {
      const store = new ustore.Async<string>();
      await store.init("store");

      await store.set("This is the announcement", "announcement");

      const announcement = await store.consume("announcement");
      assert.strictEqual(announcement, "This is the announcement");

      assert.isFalse(await store.has("announcement"));

      await store.delete();
    }

    {
      const store = new ustore.Async<{
        announcements: string[];
      }>();
      await store.init("store", {
        consume_default: { announcements: [] },
      });

      await store.set(
        {
          announcements: ["1", "2", "3"],
        },
        "movies"
      );

      const movies = (await store.consume("movies"))!;
      assert.strictEqual(movies.announcements[0], "1");
      assert.strictEqual(movies.announcements[1], "2");
      assert.strictEqual(movies.announcements[2], "3");

      assert.isTrue(await store.has("movies"));
      assert.strictEqual((await store.get("movies"))!.announcements.length, 0);

      await store.delete();
    }

    {
      const store = new ustore.Async<string[]>();
      await store.init("store", { consume_default: [] });

      await store.set(["1", "2", "3"], "movies");

      const movies = (await store.consume("movies"))!;
      assert.strictEqual(movies[0], "1");
      assert.strictEqual(movies[1], "2");
      assert.strictEqual(movies[2], "3");

      assert.isTrue(await store.has("movies"));
      assert.strictEqual((await store.get("movies"))!.length, 0);

      await store.delete();
    }
  });

  await stopwatch("page system (async)", async () => {
    const store = new ustore.Async<
      {
        i: number;
      },
      "byI"
    >();
    await store.init("store", {
      page_sz: 3,
      indexes: [{ name: "byI", path: "i" }],
    });

    for (let i = 0; i < 13; ++i) {
      await store.set({ i }, `${i}`);
      await time(1);
    }

    let page: Awaited<ReturnType<typeof store.page>>;

    {
      page = await store.page(1);
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(
        (await store.page(1, undefined, 10)).results.length,
        10
      );
      assert.strictEqual(page.results[0].value.i, 0);
      assert.strictEqual(page.results[0].key, "0");
      assert.strictEqual(page.results[1].value.i, 1);
      assert.strictEqual(page.results[1].key, "1");
      assert.strictEqual(page.results[2].value.i, 2);
      assert.strictEqual(page.results[2].key, "2");

      page = await store.page(1, undefined, undefined, 2);
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 2);
      assert.strictEqual(page.results[0].key, "2");
      assert.strictEqual(page.results[1].value.i, 3);
      assert.strictEqual(page.results[1].key, "3");
      assert.strictEqual(page.results[2].value.i, 4);
      assert.strictEqual(page.results[2].key, "4");

      page = await store.page(2);
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 3);
      assert.strictEqual(page.results[0].key, "3");
      assert.strictEqual(page.results[1].value.i, 4);
      assert.strictEqual(page.results[1].key, "4");
      assert.strictEqual(page.results[2].value.i, 5);
      assert.strictEqual(page.results[2].key, "5");

      page = await store.page(3);
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 6);
      assert.strictEqual(page.results[0].key, "6");
      assert.strictEqual(page.results[1].value.i, 7);
      assert.strictEqual(page.results[1].key, "7");
      assert.strictEqual(page.results[2].value.i, 8);
      assert.strictEqual(page.results[2].key, "8");

      page = await store.page(4);
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 9);
      assert.strictEqual(page.results[0].key, "9");
      assert.strictEqual(page.results[1].value.i, 10);
      assert.strictEqual(page.results[1].key, "10");
      assert.strictEqual(page.results[2].value.i, 11);
      assert.strictEqual(page.results[2].key, "11");

      page = await store.page(5);
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 1);
      assert.strictEqual(page.results[0].value.i, 12);
      assert.strictEqual(page.results[0].key, "12");

      page = await store.page(6);
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 0);
    }

    {
      page = await store.index("byI", {
        page: 1,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(
        (
          await store.index("byI", {
            page: 1,
            page_sz: 10,
          })
        ).results.length,
        10
      );
      assert.strictEqual(page.results[0].value.i, 0);
      assert.strictEqual(page.results[0].key, "0");
      assert.strictEqual(page.results[1].value.i, 1);
      assert.strictEqual(page.results[1].key, "1");
      assert.strictEqual(page.results[2].value.i, 2);
      assert.strictEqual(page.results[2].key, "2");

      page = await store.index("byI", {
        page: 1,
        offset: 2,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 2);
      assert.strictEqual(page.results[0].key, "2");
      assert.strictEqual(page.results[1].value.i, 3);
      assert.strictEqual(page.results[1].key, "3");
      assert.strictEqual(page.results[2].value.i, 4);
      assert.strictEqual(page.results[2].key, "4");

      page = await store.index("byI", {
        page: 2,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 3);
      assert.strictEqual(page.results[0].key, "3");
      assert.strictEqual(page.results[1].value.i, 4);
      assert.strictEqual(page.results[1].key, "4");
      assert.strictEqual(page.results[2].value.i, 5);
      assert.strictEqual(page.results[2].key, "5");

      page = await store.index("byI", {
        page: 3,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 6);
      assert.strictEqual(page.results[0].key, "6");
      assert.strictEqual(page.results[1].value.i, 7);
      assert.strictEqual(page.results[1].key, "7");
      assert.strictEqual(page.results[2].value.i, 8);
      assert.strictEqual(page.results[2].key, "8");

      page = await store.index("byI", {
        page: 4,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 9);
      assert.strictEqual(page.results[0].key, "9");
      assert.strictEqual(page.results[1].value.i, 10);
      assert.strictEqual(page.results[1].key, "10");
      assert.strictEqual(page.results[2].value.i, 11);
      assert.strictEqual(page.results[2].key, "11");

      page = await store.index("byI", {
        page: 5,
      });
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 1);
      assert.strictEqual(page.results[0].value.i, 12);
      assert.strictEqual(page.results[0].key, "12");

      page = await store.index("byI", {
        page: 6,
      });
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 0);
    }

    {
      page = await store.index("byI", {
        page: 1,
        mode: "above",
        value: 2,
        inclusive: true,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 2);
      assert.strictEqual(page.results[0].key, "2");
      assert.strictEqual(page.results[1].value.i, 3);
      assert.strictEqual(page.results[1].key, "3");
      assert.strictEqual(page.results[2].value.i, 4);
      assert.strictEqual(page.results[2].key, "4");
      page = await store.index("byI", {
        page: 2,
        mode: "above",
        value: 2,
        inclusive: true,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 5);
      assert.strictEqual(page.results[0].key, "5");
      assert.strictEqual(page.results[1].value.i, 6);
      assert.strictEqual(page.results[1].key, "6");
      assert.strictEqual(page.results[2].value.i, 7);
      assert.strictEqual(page.results[2].key, "7");
      page = await store.index("byI", {
        page: 3,
        mode: "above",
        value: 2,
        inclusive: true,
      });
      assert.isTrue(page.has_next);
      assert.strictEqual(page.results.length, 3);
      assert.strictEqual(page.results[0].value.i, 8);
      assert.strictEqual(page.results[0].key, "8");
      assert.strictEqual(page.results[1].value.i, 9);
      assert.strictEqual(page.results[1].key, "9");
      assert.strictEqual(page.results[2].value.i, 10);
      assert.strictEqual(page.results[2].key, "10");
      page = await store.index("byI", {
        page: 4,
        mode: "above",
        value: 2,
        inclusive: true,
      });
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 2);
      assert.strictEqual(page.results[0].value.i, 11);
      assert.strictEqual(page.results[0].key, "11");
      assert.strictEqual(page.results[1].value.i, 12);
      assert.strictEqual(page.results[1].key, "12");
      page = await store.index("byI", {
        page: 5,
        mode: "above",
        value: 2,
        inclusive: true,
      });
      assert.isFalse(page.has_next);
      assert.strictEqual(page.results.length, 0);
    }

    await store.delete();
  });

  await stopwatch("autoincrement (async)", async () => {
    let store = new ustore.Async<string>();
    await store.init("store", {
      autoincrement: true,
    });

    await store.set("enola");
    await store.set("rick");

    assert.strictEqual(await store.get(1), "enola");
    assert.strictEqual(await store.get(2), "rick");

    await store.delete();
  });

  await stopwatch("keypath (async)", async () => {
    const store = new ustore.Async<{
      id: number;
      slug: string;
    }>();
    await store.init("store", {
      keypath: "id",
    });

    await store.set({
      id: 345,
      slug: "enola",
    });
    await store.set({
      id: 521,
      slug: "rick",
    });

    assert.strictEqual((await store.get(345))?.slug, "enola");
    assert.strictEqual((await store.get(521))?.slug, "rick");

    await store.delete();
  });

  await stopwatch("last_modified (async)", async () => {
    const store = new ustore.Async<string>();
    await store.init("store", {
      autoincrement: true,
    });
    const parallel_store = new ustore.Async();
    await parallel_store.init("store");

    assert.strictEqual(store.last_modified, -1);
    assert.strictEqual(parallel_store.last_modified, -1);

    let before: number;
    let key: ustore.Key;

    before = Date.now();
    key = await store.set("4", undefined, { expiry: Date.now() + 300 });
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    before = Date.now();
    await store.update(key, { value: "5" });
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    await time(300);
    before = Date.now();
    await store.has("");
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    await time(10);

    key = await store.set("4");
    before = Date.now();
    await store.consume(key);
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    await time(10);

    key = await store.set("4");
    before = Date.now();
    await store.rm(key);
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    await time(10);

    await store.set("4");
    before = Date.now();
    await store.clear();
    assert.isAtLeast(store.last_modified, before);
    assert.isAtMost(store.last_modified, Date.now());
    assert.isAtLeast(parallel_store.last_modified, before);
    assert.isAtMost(parallel_store.last_modified, Date.now());

    parallel_store.close();
    await store.delete();
  });
}

console.log("Done!");
