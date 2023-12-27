import { IDBPDatabase, deleteDB, openDB } from "idb";
import { Async_Storage, Options, Store } from "./types";

export class UStore<T> {
  private _identifier!: string;
  kind!: Parameters<typeof this.init>["0"]["kind"];
  private _storage!: Async_Storage;
  on_change: ((store: UStore<T>) => Promise<void>)[] = [];
  private _middlewares: Parameters<typeof this.init>["0"]["middlewares"];

  private async _on_change() {
    const on_change = this.on_change;
    this.on_change = [];

    for (const fn of this.on_change) {
      await fn(this);
    }

    this.on_change = on_change;
  }

  private _queue: ((store: UStore<T>) => Promise<void>)[] = [];

  queue(fn: (store: UStore<T>) => Promise<UStore<T>>) {
    this._queue.push(async (store) => {
      const updated = await fn(store);
      updated._queue.shift()?.(updated);
    });

    this._queue.shift()?.(this);
  }

  async init({
    identifier,
    kind,
    middlewares,
  }: {
    identifier: string;
    kind: "local" | "session" | "memory" | "indexeddb";
    middlewares?: Partial<{
      get: (store: UStore<T>, key: string) => Promise<string>;
    }>;
  }) {
    this._identifier = identifier;
    this.kind = kind;
    if (kind == "local") {
      this._storage = localStorage as unknown as Async_Storage;
    } else if (kind == "session") {
      this._storage = sessionStorage as unknown as Async_Storage;
    } else if (kind == "memory") {
      this._storage = new Memory_Storage();
    } else {
      this._storage = new IndexedDB_Storage();
      await (this._storage as IndexedDB_Storage).init(this._identifier);
    }
    this._middlewares = middlewares;
  }

  async get(key: string): Promise<T | null> {
    if (this._middlewares?.get) {
      const middleware_get = this._middlewares.get;
      this._middlewares.get = undefined;

      key = await middleware_get(this, key);

      this._middlewares.get = middleware_get;
    }
    const store = await this._get();
    return store[key]?.value ?? null;
  }

  async has(key: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(await this._get(), key);
  }

  async set(key: string, value: T, options?: Partial<Options>) {
    const store = await this._get();
    store[key] = {
      value,
      options,
    };
    await this._set(store);
  }

  async update(key: string, value?: Partial<T>, options?: Partial<Options>) {
    const store = await this._get();
    if (!store[key]) {
      throw new Error("cannot update non-existing entry");
    }

    store[key] = {
      value: { ...store[key].value, ...value },
      options: { ...store[key].options, ...options },
    };

    await this._set(store);
  }

  async rm(key: string) {
    const store = await this._get();
    delete store[key];
    await this._set(store);
  }

  async clear() {
    await this._create_new();
  }

  async delete() {
    if (this.kind == "indexeddb") {
      await (this._storage as IndexedDB_Storage).delete();
    } else {
      await this._storage.removeItem(this._identifier);
    }
  }

  async export() {
    return JSON.stringify(await this._get());
  }

  async import(store: string) {
    await this._set(JSON.parse(store));
  }

  async length() {
    return Object.keys(await this._get()).length;
  }

  async all() {
    return Object.entries(await this._get()).map(([_, entry]) => entry.value);
  }

  private async _get() {
    const store = JSON.parse(
      (await this._storage.getItem(this._identifier)) ?? "null"
    ) as Store<T> | null;

    if (store) {
      return this._rm_expired(store);
    }

    return this._create_new();
  }

  private async _set(store: Store<T>) {
    await this._storage.setItem(this._identifier, JSON.stringify(store));
    await this._on_change();
  }

  private async _rm_expired(store: Store<T>): Promise<Store<T>> {
    Object.entries(store).forEach(([key, value]) => {
      if (value.options?.expiry && Date.now() >= value.options.expiry) {
        delete store[key];
      }
    });
    await this._set(store);
    return store;
  }

  private async _create_new(): Promise<Store<T>> {
    const store: Store<T> = {};
    await this._set(store);
    return store;
  }
}

class Memory_Storage implements Async_Storage {
  _data: Record<string, string | undefined> = {};

  async getItem(key: string) {
    return this._data[key] ?? null;
  }

  async setItem(key: string, value: string) {
    this._data[key] = value;
  }

  async removeItem(key: string) {
    delete this._data[key];
  }

  async clear() {
    this._data = {};
  }
}

class IndexedDB_Storage implements Async_Storage {
  private _db!: IDBPDatabase;
  private _identifier!: string;

  async init(identifier: string) {
    this._identifier = identifier;
    this._db = await openDB(identifier, 1, {
      upgrade(database) {
        database.createObjectStore(identifier);
      },
    });
  }

  async getItem(key: string): Promise<string> {
    return this._db
      .transaction(this._identifier)
      .objectStore(this._identifier)
      .get(key);
  }

  async setItem(key: string, value: string) {
    const tx = this._db.transaction(this._identifier, "readwrite");
    tx.objectStore(this._identifier).put(value, key);
    await tx.done;
  }

  async removeItem(key: string) {
    const tx = this._db.transaction(this._identifier, "readwrite");
    tx.objectStore(this._identifier).delete(key);
    await tx.done;
  }

  async clear() {
    const tx = this._db.transaction(this._identifier, "readwrite");
    tx.objectStore(this._identifier).clear();
    await tx.done;
  }

  async delete() {
    this._db.addEventListener("close", async () => {
      await deleteDB(this._identifier);
    });
    this._db.close();
  }
}
