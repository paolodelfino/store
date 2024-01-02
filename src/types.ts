import { ustore } from "./index";

export type Param<
  T extends (...args: any) => any,
  U extends number,
  V extends keyof Parameters<T>[U] | undefined = undefined
> = V extends keyof Parameters<T>[U] ? Parameters<T>[U][V] : Parameters<T>[U];

export type Constr<
  T extends abstract new (...args: any) => any,
  U extends number,
  V extends keyof ConstructorParameters<T>[U] | undefined = undefined
> = V extends keyof ConstructorParameters<T>[U]
  ? ConstructorParameters<T>[U][V]
  : ConstructorParameters<T>[U];

export type Store<T> = Record<string, Entry<T>>;

export interface Options {
  expiry: number;
}

export interface Entry<T> {
  value: T;
  options?: Partial<Options>;
}

export type Middlewares<T extends object | string> =
  | Partial<{
      get: (store: ustore.Async<T>, key: string) => Promise<string>;
    }>
  | undefined;
