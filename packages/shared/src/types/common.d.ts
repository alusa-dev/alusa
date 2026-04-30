/**
 * Tipos comuns compartilhados
 */
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;
export type Result<T, E = Error> = {
    success: true;
    data: T;
} | {
    success: false;
    error: E;
};
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
export declare const ok: <T>(data: T) => Result<T, never>;
export declare const err: <E>(error: E) => Result<never, E>;
//# sourceMappingURL=common.d.ts.map