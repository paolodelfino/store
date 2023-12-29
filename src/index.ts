import { IDBPDatabase, openDB } from "idb";
import { Constr, Options, Param, Store } from "./types";
import { Memory_Storage } from "./utils";

export namespace ustore {
  export class Sync<T extends object> {
    private _storage!: Storage;
    private _middlewares: Constr<typeof Sync<T>, 0, "middlewares">;

    identifier: Constr<typeof Sync<T>, 0, "identifier">;
    kind: Constr<typeof Sync<T>, 0, "kind">;

    constructor({
      identifier,
      kind,
      middlewares,
    }: {
      identifier: string;
      kind: "local" | "session" | "memory";
      middlewares?: Partial<{
        get: (store: Sync<T>, key: string) => string;
      }>;
    }) {
      this.identifier = identifier;
      this.kind = kind;
      switch (this.kind) {
        case "local":
          this._storage = localStorage;
        case "session":
          this._storage = sessionStorage;
        case "memory":
          this._storage = new Memory_Storage();
      }
      this._middlewares = middlewares;
    }

    get(key: string): T | undefined {
      if (this._middlewares?.get) {
        const middleware_get = this._middlewares.get;
        this._middlewares.get = undefined;

        key = middleware_get(this, key);

        this._middlewares.get = middleware_get;
      }
      const store = this._get();
      return store[key]?.value;
    }

    has(key: string): boolean {
      return Object.prototype.hasOwnProperty.call(this._get(), key);
    }

    set(key: string, value: T, options?: Partial<Options>) {
      const store = this._get();
      store[key] = {
        value,
        options,
      };
      this._set(store);
    }

    update(key: string, value?: Partial<T>, options?: Partial<Options>) {
      const store = this._get();
      if (!store[key]) {
        throw new Error("cannot update non-existing entry");
      }

      store[key] = {
        value: { ...store[key].value, ...value },
        options: { ...store[key].options, ...options },
      };

      this._set(store);
    }

    rm(key: string) {
      const store = this._get();
      delete store[key];
      this._set(store);
    }

    clear() {
      this._create_new();
    }

    delete() {
      this._storage.removeItem(this.identifier);
    }

    export() {
      return JSON.stringify(this._get());
    }

    import(store: string) {
      this._set(JSON.parse(store));
    }

    get length() {
      return Object.keys(this._get()).length;
    }

    values() {
      return Object.entries(this._get()).map(([_, entry]) => entry.value);
    }

    private _get() {
      const store = JSON.parse(
        this._storage.getItem(this.identifier) ?? "null"
      ) as Store<T> | null;

      if (store) {
        return this._rm_expired(store);
      }

      return this._create_new();
    }

    private _set(store: Store<T>) {
      this._storage.setItem(this.identifier, JSON.stringify(store));
    }

    private _rm_expired(store: Store<T>): Store<T> {
      Object.entries(store).forEach(([key, value]) => {
        if (value.options?.expiry && Date.now() >= value.options.expiry) {
          delete store[key];
        }
      });
      this._set(store);
      return store;
    }

    private _create_new(): Store<T> {
      const store: Store<T> = {};
      this._set(store);
      return store;
    }
  }

  export class Async<T extends object | string> {
    private _db!: IDBPDatabase;
    private _middlewares: Param<typeof this.init, 0, "middlewares">;
    private _type!: "o" | "s";

    identifier!: Param<typeof this.init, 0, "identifier">;

    async init({
      identifier,
      middlewares,
      type,
    }: {
      type: "object" | "string";
      identifier: string;
      middlewares?: Partial<{
        get: (store: Async<T>, key: string) => string;
      }>;
    }) {
      this._type = type == "object" ? "o" : "s";
      this.identifier = identifier;
      this._middlewares = middlewares;
      this._db = await openDB(identifier, 1, {
        upgrade(database) {
          database.createObjectStore(identifier);
        },
      });
    }

    async get(key: string) {
      if (!(await this.has(key))) {
        return;
      }

      const table = this._db.transaction(this.identifier, "readonly", {
        durability: "relaxed",
      }).store;

      let cursor = await table.openCursor();
      if (this._type == "o") {
        while (cursor) {
          const sep = cursor.value.indexOf("-");
          const noptions = Number(cursor.value.slice(0, sep));
          const nprops = Number(cursor.value.slice(sep + 1));

          if (cursor.key == key) {
            const o = {};

            await cursor.advance(noptions + 1);

            for (let i = 0; i < nprops; ++i, await cursor.continue()) {
              // @ts-ignore
              o[cursor.key.substring(key.length + 1)] = cursor.value;
            }

            return o as T;
          }

          cursor = await cursor.advance(noptions + nprops + 1);
        }
      } else {
        while (cursor) {
          const sep = cursor.value.indexOf("-");
          const noptions = Number(cursor.value.slice(0, sep));

          if (cursor.key == key) {
            await cursor.advance(noptions + 1);

            return cursor.value.slice(sep + 1) as T;
          }

          cursor = await cursor.advance(noptions + 1);
        }
      }

      // if (this._middlewares?.get) {
      //   const middleware_get = this._middlewares.get;
      //   this._middlewares.get = undefined;

      //   // key = middleware_get(this, key);

      //   this._middlewares.get = middleware_get;
      // }
      // const store = this._get();
      // return store[key]?.value;
    }

    async has(key: string) {
      const table = this._db.transaction(this.identifier, "readonly", {
        durability: "relaxed",
      }).store;

      let cursor = await table.openCursor();
      if (this._type == "o") {
        while (cursor) {
          if (cursor.key == key) {
            return true;
          }

          const sep = cursor.value.indexOf("-");
          const noptions = Number(cursor.value.slice(0, sep));
          const nprops = Number(cursor.value.slice(sep + 1));

          cursor = await cursor.advance(noptions + nprops + 1);
        }
      } else {
        while (cursor) {
          if (cursor.key.toString() == key) {
            return true;
          }

          const sep = cursor.value.indexOf("-");
          const noptions = Number(cursor.value.slice(0, sep));

          cursor = await cursor.advance(noptions + 1);
        }
      }

      return false;
    }

    async set(key: string, value: T, options: Partial<Options> = {}) {
      if (await this.has(key)) {
        throw new Error(`cannot set a value of a pre-existing key: "${key}"`);
      }

      const table = this._db.transaction(this.identifier, "readwrite", {
        durability: "relaxed",
      }).store;

      if (this._type == "o") {
        await table.add(
          `${Object.keys(options).length}-${Object.keys(value).length}`,
          key
        );
      } else {
        await table.add(`${Object.keys(options).length}-${value}`, key);
      }

      for (const option in options) {
        await table.add(
          options[option as keyof NonNullable<Param<typeof this.set, 2>>],
          `${key}-${option}`
        );
      }

      if (this._type == "o") {
        for (const prop in value) {
          await table.add(value[prop], `${key}-${prop}`);
        }
      }
    }

    async debug() {
      const table = this._db.transaction(this.identifier).store;

      let cursor = await table.openCursor();
      console.log("DEBUG");
      while (cursor) {
        console.log(`${cursor.key}: ${cursor.value}`);

        cursor = await cursor.continue();
      }
    }

    update(key: string, value?: Partial<T>, options?: Partial<Options>) {
      const store = this._get();
      if (!store[key]) {
        throw new Error("cannot update non-existing entry");
      }

      // store[key] = {
      //   value: { ...store[key].value, ...value },
      //   options: { ...store[key].options, ...options },
      // };

      this._set(store);
    }

    rm(key: string) {
      const store = this._get();
      delete store[key];
      this._set(store);
    }

    async clear() {
      const t = this._db.transaction(this.identifier, "readwrite");
      const table = t.objectStore(this.identifier);

      await table.clear();
    }

    delete() {
      // this._db.removeItem(this.identifier);
    }

    export() {
      return JSON.stringify(this._get());
    }

    import(store: string) {
      this._set(JSON.parse(store));
    }

    get length() {
      return Object.keys(this._get()).length;
    }

    values() {
      return Object.entries(this._get()).map(([_, entry]) => entry.value);
    }

    private _get() {
      // const store = JSON.parse(
      //   this._db.getItem(this.identifier) ?? "null"
      // ) as Store<T> | null;

      // if (store) {
      //   return this._rm_expired(store);
      // }

      return this._create_new();
    }

    private _set(store: Store<T>) {
      // this._db.setItem(this.identifier, JSON.stringify(store));
    }

    private _rm_expired(store: Store<T>): Store<T> {
      Object.entries(store).forEach(([key, value]) => {
        if (value.options?.expiry && Date.now() >= value.options.expiry) {
          delete store[key];
        }
      });
      this._set(store);
      return store;
    }

    private _create_new(): Store<T> {
      const store: Store<T> = {};
      this._set(store);
      return store;
    }
  }
}

// export class UStore<T> {
//   private _storage!: Async_Storage;
//   private _middlewares: Parameters<typeof this.init>["0"]["middlewares"];
//   private _patches: Store<T>[] = [];
//   private _patch_timeout?: number;

//   identifier!: string;
//   kind!: Parameters<typeof this.init>["0"]["kind"];

//   on_change: ((store: UStore<T>) => Promise<void>)[] = [];

//   private async _on_change() {
//     const on_change = this.on_change;
//     this.on_change = [];

//     for (const fn of this.on_change) {
//       await fn(this);
//     }

//     this.on_change = on_change;
//   }

//   private _queue: (() => Promise<void>)[] = [];

//   queue(fn: () => Promise<void>) {
//     this._queue.push(async () => {
//       const _set = this._set;
//       this._set = async (store: Store<T>) => {
//         this._push_patch(store);
//       };

//       await fn();

//       this._set = _set;

//       this._queue.shift()?.();
//     });

//     this._queue.shift()?.();
//   }

//   async init({
//     identifier,
//     kind,
//     middlewares,
//   }: {
//     identifier: string;
//     kind: "local" | "session" | "memory" | "indexeddb";
//     middlewares?: Partial<{
//       get: (store: UStore<T>, key: string) => Promise<string>;
//     }>;
//   }) {
//     this.identifier = identifier;
//     this.kind = kind;
//     if (kind == "local") {
//       this._storage = localStorage as unknown as Async_Storage;
//     } else if (kind == "session") {
//       this._storage = sessionStorage as unknown as Async_Storage;
//     } else if (kind == "memory") {
//       this._storage = new Memory_Storage();
//     } else {
//       this._storage = new IndexedDB_Storage();
//       await (this._storage as IndexedDB_Storage).init(this.identifier);
//     }
//     this._middlewares = middlewares;
//   }

//   async get(key: string): Promise<T | null> {
//     if (this._middlewares?.get) {
//       const middleware_get = this._middlewares.get;
//       this._middlewares.get = undefined;

//       key = await middleware_get(this, key);

//       this._middlewares.get = middleware_get;
//     }
//     const store = await this._get();
//     return store[key]?.value ?? null;
//   }

//   async has(key: string): Promise<boolean> {
//     return Object.prototype.hasOwnProperty.call(await this._get(), key);
//   }

//   async set(key: string, value: T, options?: Partial<Options>) {
//     const store = await this._get();
//     store[key] = {
//       value,
//       options,
//     };
//     await this._set(store);
//   }

//   async update(key: string, value?: Partial<T>, options?: Partial<Options>) {
//     const store = await this._get();
//     if (!store[key]) {
//       throw new Error("cannot update non-existing entry");
//     }

//     store[key] = {
//       value: { ...store[key].value, ...value },
//       options: { ...store[key].options, ...options },
//     };

//     await this._set(store);
//   }

//   async rm(key: string) {
//     const store = await this._get();
//     delete store[key];
//     await this._set(store);
//   }

//   async clear() {
//     await this._create_new();
//   }

//   async delete() {
//     if (this.kind == "indexeddb") {
//       await (this._storage as IndexedDB_Storage).delete();
//     } else {
//       await this._storage.removeItem(this.identifier);
//     }
//   }

//   async export() {
//     return JSON.stringify(await this._get());
//   }

//   async import(store: string) {
//     await this._set(JSON.parse(store));
//   }

//   async length() {
//     return Object.keys(await this._get()).length;
//   }

//   async all() {
//     return Object.entries(await this._get()).map(([_, entry]) => entry.value);
//   }

//   private async _get() {
//     const store = JSON.parse(
//       (await this._storage.getItem(this.identifier)) ?? "null"
//     ) as Store<T> | null;

//     if (store) {
//       return this._rm_expired(store);
//     }

//     return this._create_new();
//   }

//   private async _set(store: Store<T>) {
//     await this._storage.setItem(this.identifier, JSON.stringify(store));
//     await this._on_change();
//   }

//   private async _rm_expired(store: Store<T>): Promise<Store<T>> {
//     Object.entries(store).forEach(([key, value]) => {
//       if (value.options?.expiry && Date.now() >= value.options.expiry) {
//         delete store[key];
//       }
//     });
//     await this._set(store);
//     return store;
//   }

//   private async _create_new(): Promise<Store<T>> {
//     const store: Store<T> = {};
//     await this._set(store);
//     return store;
//   }

//   private _push_patch(patch: Store<T>) {
//     this._patches.push(patch);

//     clearTimeout(this._patch_timeout);
//     this._patch_timeout = setTimeout(async () => {
//       for (let i = 1; i < this._patches.length; ++i) {
//         for (const key of Object.keys(this._patches[i])) {
//           this._patches[0][key] = this._patches[i][key];
//         }
//       }

//       await this._storage.setItem(
//         this.identifier,
//         JSON.stringify(this._patches[0])
//       );
//       this._patches = [];
//       await this._on_change();
//     }, 100);
//   }
// }

// class IndexedDB_Storage implements Async_Storage {
//   private _db!: IDBPDatabase;
//   private _identifier!: string;

//   async init(identifier: string) {
//     this._identifier = identifier;
//     this._db = await openDB(identifier, 1, {
//       upgrade(database) {
//         database.createObjectStore(identifier);
//       },
//     });
//   }

//   async getItem(key: string): Promise<string> {
//     return this._db
//       .transaction(this._identifier)
//       .objectStore(this._identifier)
//       .get(key);
//   }

//   async setItem(key: string, value: string) {
//     const tx = this._db.transaction(this._identifier, "readwrite");
//     tx.objectStore(this._identifier).put(value, key);
//     await tx.done;
//   }

//   async removeItem(key: string) {
//     const tx = this._db.transaction(this._identifier, "readwrite");
//     tx.objectStore(this._identifier).delete(key);
//     await tx.done;
//   }

//   async clear() {
//     const tx = this._db.transaction(this._identifier, "readwrite");
//     tx.objectStore(this._identifier).clear();
//     await tx.done;
//   }

//   async delete() {
//     this._db.addEventListener("close", async () => {
//       await deleteDB(this._identifier);
//     });
//     this._db.close();
//   }
// }
