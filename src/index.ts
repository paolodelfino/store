import { Store } from "./types";

export class UStore<T> {
  private readonly _storage: Storage;
  private readonly _identifier: string;
  on_change: ((store: UStore<T>) => void)[] = [];
  private readonly _middlewares;

  private _on_change() {
    const on_change = this.on_change;
    this.on_change = [];

    this.on_change.forEach((fn) => fn(this));

    this.on_change = on_change;
  }

  constructor({
    identifier,
    kind,
    middlewares,
  }: {
    identifier: string;
    kind: "local" | "session" | "memory";
    middlewares?: Partial<{
      get: (store: UStore<T>, key: string) => string;
    }>;
  }) {
    this._identifier = identifier;
    this._storage =
      kind == "local"
        ? localStorage
        : kind == "session"
        ? sessionStorage
        : new Memory_Storage();
    this._middlewares = middlewares;
  }

  get(key: string): T | null {
    if (this._middlewares?.get) {
      const middleware_get = this._middlewares.get;
      this._middlewares.get = undefined;

      key = middleware_get(this, key);

      this._middlewares.get = middleware_get;
    }
    const store = this._get();
    return store[key]?.value ?? null;
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._get(), key);
  }

  set(key: string, value: T, options?: Partial<{ expiry: number }>) {
    const store = this._get();
    store[key] = {
      expiry: options?.expiry ?? null,
      value,
    };
    this._set(store);
  }

  update(key: string, value: Partial<T>) {
    const store = this._get();
    if (!store[key]) {
      throw new Error("cannot update non-existing entry");
    }

    store[key].value = {
      ...store[key].value,
      ...value,
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
    this._storage.removeItem(this._identifier);
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

  get all() {
    return Object.entries(this._get()).map(([_, entry]) => entry.value);
  }

  private _get() {
    const store = JSON.parse(
      this._storage.getItem(this._identifier) ?? "null"
    ) as Store<T> | null;

    if (store) {
      return this._rm_expired(store);
    }

    return this._create_new();
  }

  private _set(store: Store<T>) {
    this._storage.setItem(this._identifier, JSON.stringify(store));
    this._on_change();
  }

  private _rm_expired(store: Store<T>): Store<T> {
    Object.entries(store).forEach(([key, value]) => {
      if (value.expiry && Date.now() >= value.expiry) {
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

class Memory_Storage implements Storage {
  _data: Record<string, string | undefined> = {};
  length: number = 0;

  key(index: number): string | null {
    return Object.keys(this._data)[index] || null;
  }

  getItem(key: string) {
    return this._data[key] ?? null;
  }

  setItem(key: string, value: string) {
    this._data[key] = value;
  }

  removeItem(key: string) {
    delete this._data[key];
  }

  clear() {
    this._data = {};
  }
}
