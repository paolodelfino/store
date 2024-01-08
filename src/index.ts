import { IDBPDatabase, deleteDB, openDB } from "idb";
import { Memory_Storage } from "./utils";

export namespace ustore {
  export class Sync<T extends object> {
    private _storage!: Storage;
    private _middlewares: Constr<typeof Sync<T>, 1, "middlewares">;

    identifier: Constr<typeof Sync<T>, 0>;
    kind: Constr<typeof Sync<T>, 1, "kind">;

    constructor(
      identifier: string,
      {
        kind,
        middlewares,
      }: {
        kind: "local" | "session" | "memory";
        middlewares?: Partial<{
          get: (store: Sync<T>, key: string) => string;
        }>;
      }
    ) {
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

  export class Async<T extends object | string, U extends Index["name"]> {
    private _db!: IDBPDatabase;
    private _middlewares: Middlewares<T, U>;

    identifier!: Param<typeof this.init, 0>;

    async init(
      identifier: string,
      options?: {
        middlewares?: Middlewares<T, U>;
        version?: number;
        migrate?: (data: {
          old_version: number;
          create_index: (index: Index) => void;
          remove_index: (name: Index["name"]) => void;
        }) => Promise<void>;
        indexes?: U[];
      }
    ) {
      if (options?.version && options.version <= 0) {
        throw new Error("Database version should be at least 1");
      }

      this.identifier = identifier;
      this._middlewares = options?.middlewares;

      let migrating: Promise<unknown> | undefined;
      const temp_db = (table: any) => {
        this._db = {
          // @ts-ignore
          transaction: () => {
            return { store: table };
          },
        };
      };

      const db = await openDB(identifier, options?.version ?? 1, {
        upgrade(database, old_version, _, tx) {
          if (!database.objectStoreNames.contains(identifier)) {
            database.createObjectStore(identifier);
          }

          const table = tx.objectStore(identifier);

          if (!table.indexNames.contains("byExpiry")) {
            table.createIndex("byExpiry", "options.expiry", { unique: false });
          }
          if (!table.indexNames.contains("byTimestamp")) {
            table.createIndex("byTimestamp", "timestamp", { unique: false });
          }

          if (options?.indexes) {
            for (const { name, path, unique, multi_entry } of options.indexes) {
              table.createIndex(name, `value.${path}`, {
                unique,
                multiEntry: multi_entry,
              });
            }
          }

          if (options?.migrate) {
            temp_db(table);

            migrating = options.migrate({
              old_version,
              create_index({ name, path, multi_entry, unique }) {
                table?.createIndex(name, `value.${path}`, {
                  unique,
                  multiEntry: multi_entry,
                });
              },
              remove_index(name) {
                table?.deleteIndex(name);
              },
            });
          }
        },
      });

      await migrating;
      this._db = db;
    }

    async index(name: U["name"]) {
      const table = await this._table();
      return (await table.index(name).getAll()) as T[];
    }

    async index_only(name: U["name"], value: any) {
      const table = await this._table();
      return (await table.index(name).getAll(IDBKeyRange.only(value))) as T[];
    }

    async index_above(
      name: U["name"],
      { value, inclusive }: { value: any; inclusive?: boolean }
    ) {
      const table = await this._table();
      return (await table
        .index(name)
        .getAll(IDBKeyRange.upperBound(value, !inclusive))) as T[];
    }

    async index_below(
      name: U["name"],
      { value, inclusive }: { value: any; inclusive?: boolean }
    ) {
      const table = await this._table();
      return (await table
        .index(name)
        .getAll(IDBKeyRange.upperBound(value, !inclusive))) as T[];
    }

    async index_range(
      name: U["name"],
      {
        lower_value,
        upper_value,
        lower_inclusive,
        upper_inclusive,
      }: {
        lower_value: any;
        upper_value: any;
        lower_inclusive?: boolean;
        upper_inclusive?: boolean;
      }
    ) {
      const table = await this._table();
      return (await table
        .index(name)
        .getAll(
          IDBKeyRange.bound(
            lower_value,
            upper_value,
            !lower_inclusive,
            !upper_inclusive
          )
        )) as T[];
    }

    close() {
      this._db.close();
    }

    async update(key: string, value?: Partial<T>, options?: Partial<Options>) {
      const table = await this._table("readwrite");

      let cursor = await table.openCursor();
      while (cursor) {
        if (cursor.key == key) {
          await cursor.update({
            options: { ...cursor.value.options, ...options },
            value:
              typeof value == "object"
                ? { ...cursor.value.value, ...value }
                : value
                ? value
                : cursor.value.value,
          });
          return;
        }

        cursor = await cursor.continue();
      }

      throw new Error(`cannot update non-existing entry: "${key}"`);
    }

    async get_some(keys: string[]) {
      const entries: T[] = [];

      for (const key of keys) {
        const entry = await this.get(key);
        if (entry) {
          entries.push(entry);
        }
      }

      return entries;
    }

    async get(key: string) {
      if (this._middlewares?.get) {
        const middleware_get = this._middlewares.get;
        delete this._middlewares["get"];

        key = await middleware_get(this, key);

        this._middlewares.get = middleware_get;
      }

      const table = await this._table();

      let cursor = await table.openCursor();
      while (cursor) {
        if (cursor.key == key) {
          return cursor.value.value as T;
        }

        cursor = await cursor.continue();
      }
    }

    async has(key: string) {
      const table = await this._table();

      let cursor = await table.openKeyCursor();
      while (cursor) {
        if (cursor.key == key) {
          return true;
        }

        cursor = await cursor.continue();
      }

      return false;
    }

    async set(key: string, value: T, options: Partial<Options> = {}) {
      const table = await this._table("readwrite");

      await table.put(
        {
          value,
          options,
          timestamp: Date.now(),
        },
        key
      );
    }

    async debug() {
      const table = await this._table();

      let cursor = await table.openCursor();
      console.log("DEBUG");
      while (cursor) {
        console.log(
          `${cursor.key} (${typeof cursor.value.value}): ${cursor.value}`
        );

        cursor = await cursor.continue();
      }
    }

    async rm(key: string) {
      const table = await this._table("readwrite");

      let cursor = await table.openCursor();
      while (cursor) {
        if (cursor.key == key) {
          await cursor.delete();
          return;
        }

        cursor = await cursor.continue();
      }
    }

    async clear() {
      const table = await this._table("readwrite");

      await table.clear();
    }

    async delete() {
      this._db.close();
      await deleteDB(this.identifier);
    }

    async export() {
      const table = await this._table();
      const set = new Map<string, Entry<T>>();

      let cursor = await table.openCursor();
      while (cursor) {
        set.set(cursor.key as string, cursor.value);

        cursor = await cursor.continue();
      }

      return set;
    }

    async import(
      set: Awaited<ReturnType<typeof this.export>>,
      merge?: boolean
    ) {
      const table = await this._table("readwrite");

      if (!merge) {
        await table.clear();
      }

      for (const [key, value] of set) {
        await table.put(value, key);
      }
    }

    async length() {
      const table = await this._table();

      return await table.count();
    }

    async values() {
      const table = await this._table();

      return (await table.index("byTimestamp").getAll()).map(
        (entry) => entry.value
      ) as T[];
    }

    private async _table<T extends "readonly" | "readwrite" = "readonly">(
      mode?: T
    ) {
      await this._rm_expired();

      return this._db.transaction(this.identifier, mode, {
        durability: "relaxed",
      }).store;
    }

    private async _rm_expired() {
      const table = this._db.transaction(this.identifier, "readwrite", {
        durability: "relaxed",
      }).store;
      const by_expiry = table.index("byExpiry");

      let cursor = await by_expiry.openCursor(
        IDBKeyRange.upperBound(Date.now())
      );
      while (cursor) {
        await cursor.delete();

        cursor = await cursor.continue();
      }
    }
  }

  type Param<
    T extends (...args: any) => any,
    U extends number,
    V extends keyof Parameters<T>[U] | undefined = undefined
  > = V extends keyof Parameters<T>[U] ? Parameters<T>[U][V] : Parameters<T>[U];

  type Constr<
    T extends abstract new (...args: any) => any,
    U extends number,
    V extends keyof ConstructorParameters<T>[U] | undefined = undefined
  > = V extends keyof ConstructorParameters<T>[U]
    ? ConstructorParameters<T>[U][V]
    : ConstructorParameters<T>[U];

  type Store<T> = Record<string, Entry<T>>;

  interface Options {
    expiry: number;
  }

  export interface Entry<T> {
    value: T;
    options?: Partial<Options>;
  }

  type Middlewares<T extends object | string, U extends Index["name"]> =
    | Partial<{
        get: (store: ustore.Async<T, U>, key: string) => Promise<string>;
      }>
    | undefined;

  interface Index {
    name: string;
    path: string;
    unique?: boolean;
    multi_entry?: boolean;
  }
}
