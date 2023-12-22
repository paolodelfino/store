import { IDBPDatabase, openDB } from "idb";
import { Async_Storage, Store } from "./types";

export class UStore<T> {
  private readonly _storage: Async_Storage;
  private readonly _identifier: string;
  on_change: ((store: UStore<T>) => Promise<void>)[] = [];
  private readonly _middlewares;

  private async _on_change() {
    const on_change = this.on_change;
    this.on_change = [];

    for (const fn of this.on_change) {
      await fn(this);
    }

    this.on_change = on_change;
  }

  constructor({
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
    this._storage =
      kind == "local"
        ? (localStorage as unknown as Async_Storage)
        : kind == "session"
        ? (sessionStorage as unknown as Async_Storage)
        : kind == "indexeddb"
        ? new IndexedDB_Storage(this._identifier)
        : new Memory_Storage();
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

  async set(key: string, value: T, options?: Partial<{ expiry: number }>) {
    const store = await this._get();
    store[key] = {
      expiry: options?.expiry ?? null,
      value,
    };
    await this._set(store);
  }

  async update(key: string, value: Partial<T>) {
    const store = await this._get();
    if (!store[key]) {
      throw new Error("cannot update non-existing entry");
    }

    store[key].value = {
      ...store[key].value,
      ...value,
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
    await this._storage.removeItem(this._identifier);
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
      if (value.expiry && Date.now() >= value.expiry) {
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
  private _dbPromise: Promise<IDBPDatabase>;
  private _storeName: string;

  constructor(storeName: string) {
    this._storeName = storeName;
    this._dbPromise = openDB("UStore", 1, {
      upgrade(database) {
        database.createObjectStore(storeName);
      },
    });
  }

  async getItem(key: string): Promise<string> {
    return (await this._dbPromise)
      .transaction(this._storeName)
      .objectStore(this._storeName)
      .get(key);
  }

  async setItem(key: string, value: string) {
    const db = await this._dbPromise;
    const tx = db.transaction(this._storeName, "readwrite");
    tx.objectStore(this._storeName).put(value, key);
    await tx.done;
  }

  async removeItem(key: string) {
    const db = await this._dbPromise;
    const tx = db.transaction(this._storeName, "readwrite");
    tx.objectStore(this._storeName).delete(key);
    await tx.done;
  }

  async clear() {
    const db = await this._dbPromise;
    const tx = db.transaction(this._storeName, "readwrite");
    tx.objectStore(this._storeName).clear();
    await tx.done;
  }
}
