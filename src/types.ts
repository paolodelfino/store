export type Async_Storage = {
  clear(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type Store<T> = Record<string, Entry<T>>;

export interface Options {
  expiry: number;
}

export interface Entry<T> {
  value: T;
  options?: Partial<Options>;
}
