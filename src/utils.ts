export class Memory_Storage implements Storage {
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

export function obj_merge<T extends object, U extends EveryOpt<T>>(a: T, b: U) {
  for (const key in b) {
    if (typeof b[key] == "object") {
      // @ts-ignore
      obj_merge(a[key], b[key]);
    } else {
      // @ts-ignore
      a[key] = b[key];
    }
  }

  return a;
}

type EveryOpt<T> = T extends object
  ? {
      [P in keyof T]?: EveryOpt<T[P]>;
    }
  : T | undefined;
