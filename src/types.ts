export type Async_Storage = {
  clear(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type Store<T> = Record<string, Entry<T>>;

export interface Entry<T> {
  expiry: number | null;
  value: T;
}
