/**
 * MockKVService - Test implementation of IKVService
 *
 * Provides an in-memory KV service for testing without network dependencies.
 */
import type { IKVService, IPrefixedKVService, IServiceContext, ServiceSession, Result, KVServiceConfig, KVGetOptions, KVPutOptions, KVBatchPutItem, KVBatchPutOptions, KVBatchPutResponse, KVListOptions, KVDeleteOptions, KVHeadOptions, KVCreateSignedReadUrlOptions, KVResponse, KVListResponse, KVSignedReadUrlResponse } from "@tinycloud/sdk-services";
/**
 * Recorded operation for assertions.
 */
export interface RecordedOperation {
    type: "get" | "put" | "batchPut" | "list" | "delete" | "head" | "createSignedReadUrl";
    key?: string;
    value?: unknown;
    options?: unknown;
    timestamp: number;
}
/**
 * Error injection configuration.
 */
export interface ErrorInjection {
    /** Key pattern to match (string for exact match, RegExp for pattern) */
    pattern: string | RegExp;
    /** Error code to return */
    code: string;
    /** Error message */
    message: string;
    /** Operation types to inject error on */
    operations?: RecordedOperation["type"][];
    /** Number of times to inject (undefined = always) */
    count?: number;
}
/**
 * Configuration for MockKVService.
 */
export interface MockKVServiceConfig extends KVServiceConfig {
    /** Initial data to populate the store */
    initialData?: Record<string, unknown>;
    /** Simulated latency in milliseconds (0 = instant) */
    latencyMs?: number;
    /** Error injections for testing error handling */
    errorInjections?: ErrorInjection[];
}
/**
 * MockKVService implements IKVService for testing.
 *
 * Features:
 * - In-memory key-value store
 * - Configurable latency simulation
 * - Error injection capability
 * - Operation tracking for assertions
 *
 * @example
 * ```typescript
 * const mockKV = new MockKVService({
 *   initialData: { 'user/settings': { theme: 'dark' } },
 *   latencyMs: 10,
 * });
 * mockKV.initialize(context);
 *
 * const result = await mockKV.get('user/settings');
 * expect(result.ok).toBe(true);
 * expect(result.data.data).toEqual({ theme: 'dark' });
 *
 * // Check operations
 * expect(mockKV.getOperations('get')).toHaveLength(1);
 * ```
 */
export declare class MockKVService implements IKVService {
    static readonly serviceName = "kv";
    private _config;
    private _context;
    private _store;
    private _operations;
    private _errorInjections;
    private _latencyMs;
    private _abortController;
    constructor(config?: MockKVServiceConfig);
    get config(): KVServiceConfig;
    initialize(context: IServiceContext): void;
    onSessionChange(session: ServiceSession | null): void;
    onSignOut(): void;
    get<T = unknown>(key: string, options?: KVGetOptions): Promise<Result<KVResponse<T>>>;
    put(key: string, value: unknown, options?: KVPutOptions): Promise<Result<KVResponse<void>>>;
    batchPut(items: KVBatchPutItem[], options?: KVBatchPutOptions): Promise<Result<KVBatchPutResponse>>;
    list(options?: KVListOptions): Promise<Result<KVListResponse>>;
    delete(key: string, options?: KVDeleteOptions): Promise<Result<KVResponse<void>>>;
    head(key: string, options?: KVHeadOptions): Promise<Result<KVResponse<void>>>;
    createSignedReadUrl(key: string, options?: KVCreateSignedReadUrlOptions): Promise<Result<KVSignedReadUrlResponse>>;
    /**
     * Create a prefix-scoped view of this KV service.
     *
     * @param prefix - The prefix to apply to all operations
     * @returns A PrefixedKVService scoped to the prefix
     */
    withPrefix(prefix: string): IPrefixedKVService;
    /**
     * Get all recorded operations.
     */
    getOperations(): RecordedOperation[];
    /**
     * Get operations filtered by type.
     */
    getOperationsByType(type: RecordedOperation["type"]): RecordedOperation[];
    /**
     * Clear recorded operations.
     */
    clearOperations(): void;
    /**
     * Get the in-memory store contents.
     */
    getStoreContents(): Map<string, unknown>;
    /**
     * Directly set a value in the store (bypasses operation recording).
     */
    setStoreValue(key: string, value: unknown): void;
    /**
     * Clear the entire store.
     */
    clearStore(): void;
    /**
     * Add an error injection.
     */
    addErrorInjection(injection: ErrorInjection): void;
    /**
     * Clear all error injections.
     */
    clearErrorInjections(): void;
    /**
     * Set the simulated latency.
     */
    setLatency(ms: number): void;
    /**
     * Get the number of items in the store.
     */
    get storeSize(): number;
    /**
     * Check if a key exists in the store.
     */
    hasKey(key: string): boolean;
    private getFullKey;
    private createStoredValue;
    private createHeaders;
    private recordOperation;
    private checkErrorInjection;
    private simulateLatency;
}
//# sourceMappingURL=MockKVService.d.ts.map