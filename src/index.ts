import { IDBPCursorWithValue, IDBPDatabase, deleteDB, openDB } from "idb";
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

  export class Async<
    Value extends object | string | any[],
    Indexes extends string = "There is no index available"
  > {
    private _db!: IDBPDatabase;
    private _middlewares: Middlewares<Value, Indexes>;
    private _consume_default?: Value;
    private _page_sz!: number;

    identifier!: Param<typeof this.init, 0>;

    /**
     * @param page_sz Defaults to 10
     * @param version Starts from 1
     */
    async init(
      identifier: string,
      options?: {
        middlewares?: Middlewares<Value, Indexes>;
        version?: number;
        migrate?: (data: {
          old_version: number;
          remove_index: (name: string) => void;
        }) => Promise<void>;
        indexes?: Index<Indexes>[];
        consume_default?: Value;
        page_sz?: number;
        autoincrement?: boolean;
        keypath?: Value extends object ? Key : undefined;
      }
    ) {
      if (options?.version && options.version <= 0) {
        throw new Error("Database version should be at least 1");
      }

      this.identifier = identifier;
      this._middlewares = options?.middlewares;
      this._consume_default = options?.consume_default;
      this._page_sz = options?.page_sz ?? 10;

      let migrating: Promise<void> | undefined;
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
            database.createObjectStore(identifier, {
              autoIncrement: options?.autoincrement,
              keyPath: options?.keypath
                ? `value.${options.keypath}`
                : undefined,
            });
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
              if (!table.indexNames.contains(name)) {
                table.createIndex(name, `value.${path}`, {
                  unique,
                  multiEntry: multi_entry,
                });
              }
            }
          }

          if (options?.migrate) {
            temp_db(table);

            migrating = options.migrate({
              old_version,
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

    /**
     * @param number Starts from 1
     */
    async page(number: number, reverse?: boolean) {
      const table = (await this._table()).index("byTimestamp");

      let cursor: IDBPCursorWithValue | null | undefined =
        await table.openCursor(undefined, reverse ? "prev" : undefined);

      const skip = (number - 1) * this._page_sz;
      if (skip > 0) {
        cursor = await cursor?.advance(skip);
      }

      const results: Key_Value_Pair<Value>[] = [];

      let i = 0;
      while (i < this._page_sz && cursor) {
        results.push({
          key: cursor.primaryKey as Key,
          value: cursor.value.value,
        });

        ++i;
        cursor = await cursor.continue();
      }

      return {
        results,
        has_next: !!cursor,
      };
    }

    close() {
      this._db.close();
    }

    indexes(): Indexes[] {
      return Array.from(this._db.transaction("store").store.indexNames).filter(
        (index) => index != "byExpiry" && index != "byTimestamp"
      ) as Indexes[];
    }

    async index(name: Index<Indexes>["name"]): Promise<Key_Value_Pair<Value>[]>;
    async index(
      name: Index<Indexes>["name"],
      options: {
        reverse: boolean;
      }
    ): Promise<Key_Value_Pair<Value>[]>;
    async index(
      name: Index<Indexes>["name"],
      options:
        | {
            mode: "only";
            value: any;
          }
        | {
            mode: "above";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "below";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "range";
            lower_value: any;
            upper_value: any;
            lower_inclusive?: boolean;
            upper_inclusive?: boolean;
          }
    ): Promise<Key_Value_Pair<Value>[]>;
    async index(
      name: Index<Indexes>["name"],
      options: {
        reverse: boolean;
      } & (
        | {
            mode: "only";
            value: any;
          }
        | {
            mode: "above";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "below";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "range";
            lower_value: any;
            upper_value: any;
            lower_inclusive?: boolean;
            upper_inclusive?: boolean;
          }
      )
    ): Promise<Key_Value_Pair<Value>[]>;

    /**
     * @param page Starts from 1
     */
    async index(
      name: Index<Indexes>["name"],
      options: {
        page: number;
      } & (
        | {
            mode: "only";
            value: any;
          }
        | {
            mode: "above";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "below";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "range";
            lower_value: any;
            upper_value: any;
            lower_inclusive?: boolean;
            upper_inclusive?: boolean;
          }
      )
    ): Promise<{ results: Key_Value_Pair<Value>[]; has_next: boolean }>;
    /**
     * @param page Starts from 1
     */
    async index(
      name: Index<Indexes>["name"],
      options: {
        page: number;
        reverse: boolean;
      } & (
        | {
            mode: "only";
            value: any;
          }
        | {
            mode: "above";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "below";
            value: any;
            inclusive?: boolean;
          }
        | {
            mode: "range";
            lower_value: any;
            upper_value: any;
            lower_inclusive?: boolean;
            upper_inclusive?: boolean;
          }
      )
    ): Promise<{ results: Key_Value_Pair<Value>[]; has_next: boolean }>;
    /**
     * @param page Starts from 1
     */
    async index(
      name: Index<Indexes>["name"],
      options: { page: number }
    ): Promise<{ results: Key_Value_Pair<Value>[]; has_next: boolean }>;
    /**
     * @param page Starts from 1
     */
    async index(
      name: Index<Indexes>["name"],
      options: { page: number; reverse: boolean }
    ): Promise<{ results: Key_Value_Pair<Value>[]; has_next: boolean }>;

    async index(
      name: Index<Indexes>["name"],
      options?: {
        page?: number;
        reverse?: boolean;
      } & (
        | {
            mode?: "only";
            value?: any;
          }
        | {
            mode?: "above";
            value?: any;
            inclusive?: boolean;
          }
        | {
            mode?: "below";
            value?: any;
            inclusive?: boolean;
          }
        | {
            mode?: "range";
            lower_value?: any;
            upper_value?: any;
            lower_inclusive?: boolean;
            upper_inclusive?: boolean;
          }
      )
    ) {
      const table = await this._table();

      const index = table.index(name);

      let query: IDBKeyRange | undefined = undefined;
      if (options?.mode) {
        switch (options.mode) {
          case "only":
            query = IDBKeyRange.only(options.value);
            break;
          case "above":
            query = IDBKeyRange.lowerBound(options.value, !options.inclusive);
            break;
          case "below":
            query = IDBKeyRange.upperBound(options.value, !options.inclusive);
            break;
          case "range":
            query = IDBKeyRange.bound(
              options.lower_value,
              options.upper_value,
              !options.lower_inclusive,
              !options.upper_inclusive
            );
            break;
        }
      }

      let values: (Key_Value_Pair<Value> & { timestamp: number })[] = [];

      let cursor = await index.openCursor(query);
      while (cursor) {
        values.push({
          key: cursor.primaryKey as Key,
          value: cursor.value.value,
          timestamp: cursor.value.timestamp,
        });

        cursor = await cursor.continue();
      }

      if (options?.reverse) {
        values.sort((a, b) => b.timestamp - a.timestamp);
      } else {
        values.sort((a, b) => a.timestamp - b.timestamp);
      }

      if (!options?.page) {
        return values.map((entry) => ({
          value: entry.value,
          key: entry.key,
        }));
      }

      const results: Key_Value_Pair<Value>[] = [];

      const end = options.page * this._page_sz;
      for (let i = (options.page - 1) * this._page_sz; i < end; i++) {
        if (values[i]) {
          results.push({
            value: values[i].value,
            key: values[i].key,
          });
        }
      }

      return {
        results,
        has_next: !!values[end],
      };
    }

    async update(
      key: Key,
      data: (old: Async_Entry<Value>) => Promise<{
        value?: Partial<Value>;
        options?: Partial<Options>;
      }>
    ): Promise<void>;
    async update(
      key: Key,
      data: {
        value?: Partial<Value>;
        options?: Partial<Options>;
      }
    ): Promise<void>;

    async update(
      key: Key,
      data:
        | ((old: Async_Entry<Value>) => Promise<{
            value?: Partial<Value>;
            options?: Partial<Options>;
          }>)
        | {
            value?: Partial<Value>;
            options?: Partial<Options>;
          }
    ) {
      const cursor = await (await this._table("readwrite")).openCursor(key);
      if (!cursor) {
        throw new Error(
          `cannot update non-existing entry: (${typeof key}) "${key}"`
        );
      }

      const { options, value } =
        typeof data == "function"
          ? await data({
              options: cursor.value.options,
              timestamp: cursor.value.timestamp,
              value: cursor.value.value,
            })
          : data;

      await cursor.update({
        options: { ...cursor.value.options, ...options },
        value:
          typeof value == "object"
            ? Array.isArray(value)
              ? [...cursor.value.value, ...value]
              : { ...cursor.value.value, ...value }
            : value
            ? value
            : cursor.value.value,
      });
    }

    async get_some(keys: Key[]) {
      const entries: Value[] = [];

      for (const key of keys) {
        const entry = await this.get(key);
        if (entry) {
          entries.push(entry);
        }
      }

      return entries;
    }

    async get(key: Key) {
      if (this._middlewares?.get) {
        const middleware_get = this._middlewares.get;
        delete this._middlewares["get"];

        key = await middleware_get(this, key);

        this._middlewares.get = middleware_get;
      }

      return (await (await this._table()).get(key))?.value as
        | Async_Entry<Value>["value"]
        | undefined;
    }

    async consume(key: Key) {
      const cursor = await (await this._table("readwrite")).openCursor(key);
      if (cursor) {
        const value = cursor.value.value as Async_Entry<Value>["value"];

        if (this._consume_default != undefined) {
          await cursor.update({
            value: this._consume_default,
          });
        } else {
          await cursor.delete();
        }

        return value;
      }
    }

    async has(key: Key) {
      return !!(await (await this._table()).getKey(key));
    }

    /**
     * @param value If keypath was set but autoincrement was not, make sure `value` has the prop keypath is pointing to
     * @param key If keypath was set, it must be `undefined`. If both autoincrement and keypath were not set, it must be `Key`
     */
    async set(
      value: Value,
      key?: Key,
      options: Async_Entry<Value>["options"] = {}
    ) {
      return (await (
        await this._table("readwrite")
      ).put(
        {
          value,
          options,
          timestamp: Date.now(),
        },
        key
      )) as Key;
    }

    async debug() {
      console.log("DEBUG");

      const table = await this._table();

      console.log("indexes", table.indexNames);

      for (const index of table.indexNames) {
        console.log(index, await table.index(index).getAll());
      }

      let cursor = await table.openCursor();
      while (cursor) {
        console.log(
          `${cursor.key} (${typeof cursor.value.value}): ${JSON.stringify(
            cursor.value,
            null,
            2
          )}`
        );

        cursor = await cursor.continue();
      }
    }

    async rm(key: Key) {
      return (await (await this._table("readwrite")).openCursor(key))?.delete();
    }

    async clear() {
      return (await this._table("readwrite")).clear();
    }

    delete() {
      this._db.close();
      return deleteDB(this.identifier);
    }

    async export() {
      const table = await this._table();
      const set = new Map<Key, Entry<Value>>();

      let cursor = await table.openCursor();
      while (cursor) {
        set.set(cursor.key as Key, cursor.value);

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
      return await (await this._table()).count();
    }

    async values(reverse?: boolean) {
      let results: Key_Value_Pair<Value>[] = [];

      let cursor = await (await this._table())
        .index("byTimestamp")
        .openCursor(undefined, reverse ? "prev" : undefined);
      while (cursor) {
        results.push({
          key: cursor.primaryKey as Key,
          value: cursor.value.value,
        });

        cursor = await cursor.continue();
      }

      return results;
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

  type Middlewares<
    Value extends object | string | any[],
    Indexes extends string
  > =
    | Partial<{
        get: (store: ustore.Async<Value, Indexes>, key: Key) => Promise<Key>;
      }>
    | undefined;

  interface Index<U> {
    name: U;
    path: string;
    unique?: boolean;
    multi_entry?: boolean;
  }

  type Key = string | number;

  interface Async_Entry<T> {
    value: T;
    options: Partial<Options>;
    timestamp: number;
  }

  interface Key_Value_Pair<T> {
    value: T;
    key: Key;
  }
}
