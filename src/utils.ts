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
