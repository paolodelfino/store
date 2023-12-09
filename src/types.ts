export type Store<T> = Record<string, Entry<T>>;

export interface Entry<T> {
  expiry: number | null;
  value: T;
}
