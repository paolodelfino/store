export type Param<
  T extends (...args: any) => any,
  U extends number,
  V extends keyof Parameters<T>[U] | undefined = undefined
> = V extends keyof Parameters<T>[U] ? Parameters<T>[U][V] : Parameters<T>[U];

export type Store<T> = Record<string, Entry<T>>;

export interface Options {
  expiry: number;
}

export interface Entry<T> {
  value: T;
  options?: Partial<Options>;
}
