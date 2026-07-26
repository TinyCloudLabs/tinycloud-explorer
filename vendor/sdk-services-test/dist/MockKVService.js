/**
 * MockKVService - Test implementation of IKVService
 *
 * Provides an in-memory KV service for testing without network dependencies.
 */
import { DEFAULT_SIGNED_READ_URL_EXPIRY_MS, ok, err, ErrorCodes, serviceError, PrefixedKVService, } from "@tinycloud/sdk-services";
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
export class MockKVService {
    constructor(config = {}) {
        this._store = new Map();
        this._operations = [];
        this._abortController = new AbortController();
        this._config = config;
        this._latencyMs = config.latencyMs ?? 0;
        this._errorInjections = [...(config.errorInjections ?? [])];
        // Initialize with seed data
        if (config.initialData) {
            for (const [key, value] of Object.entries(config.initialData)) {
                this._store.set(key, this.createStoredValue(value));
            }
        }
    }
    get config() {
        return this._config;
    }
    initialize(context) {
        this._context = context;
    }
    onSessionChange(session) {
        // No-op for mock
    }
    onSignOut() {
        this._abortController.abort();
        this._abortController = new AbortController();
    }
    // ============================================================
    // KV Operations
    // ============================================================
    async get(key, options) {
        this.recordOperation("get", key, undefined, options);
        const fullKey = this.getFullKey(key, options?.prefix);
        // Check for error injection
        const injectedError = this.checkErrorInjection(fullKey, "get");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        const stored = this._store.get(fullKey);
        if (!stored) {
            return err(serviceError(ErrorCodes.KV_NOT_FOUND, `Key not found: ${key}`, "kv"));
        }
        return ok({
            data: stored.data,
            headers: this.createHeaders(stored),
        });
    }
    async put(key, value, options) {
        this.recordOperation("put", key, value, options);
        const fullKey = this.getFullKey(key, options?.prefix);
        // Check for error injection
        const injectedError = this.checkErrorInjection(fullKey, "put");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        const stored = this.createStoredValue(value, options?.contentType);
        this._store.set(fullKey, stored);
        return ok({
            data: undefined,
            headers: this.createHeaders(stored),
        });
    }
    async batchPut(items, options) {
        this.recordOperation("batchPut", undefined, items, options);
        if (items.length === 0) {
            return ok({ written: [], count: 0 });
        }
        const entries = items.map((item) => ({
            item,
            fullKey: this.getFullKey(item.key, options?.prefix),
        }));
        const seen = new Set();
        for (const { fullKey } of entries) {
            if (seen.has(fullKey)) {
                return err(serviceError(ErrorCodes.INVALID_INPUT, `KV batchPut received duplicate key after prefix resolution: ${fullKey}`, "kv"));
            }
            seen.add(fullKey);
        }
        for (const { fullKey } of entries) {
            const injectedError = this.checkErrorInjection(fullKey, "batchPut");
            if (injectedError) {
                return err(injectedError);
            }
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        for (const { item, fullKey } of entries) {
            this._store.set(fullKey, this.createStoredValue(item.value, item.contentType));
        }
        const written = entries.map(({ fullKey }) => fullKey);
        return ok({ written, count: written.length });
    }
    async list(options) {
        this.recordOperation("list", options?.prefix ?? options?.path, undefined, options);
        // Build prefix
        let prefix = options?.prefix ?? this._config.prefix ?? "";
        if (options?.path) {
            prefix = prefix ? `${prefix}/${options.path}` : options.path;
        }
        // Check for error injection
        const injectedError = this.checkErrorInjection(prefix, "list");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        let keys = Array.from(this._store.keys());
        // Filter by prefix
        if (prefix) {
            const prefixWithSlash = prefix.endsWith("/") ? prefix : `${prefix}/`;
            keys = keys.filter((k) => k === prefix || k.startsWith(prefixWithSlash));
        }
        // Optionally remove prefix
        if (options?.removePrefix && prefix) {
            const prefixWithSlash = prefix.endsWith("/") ? prefix : `${prefix}/`;
            keys = keys.map((k) => k.startsWith(prefixWithSlash) ? k.slice(prefixWithSlash.length) : k);
        }
        return ok({ keys });
    }
    async delete(key, options) {
        this.recordOperation("delete", key, undefined, options);
        const fullKey = this.getFullKey(key, options?.prefix);
        // Check for error injection
        const injectedError = this.checkErrorInjection(fullKey, "delete");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        const stored = this._store.get(fullKey);
        if (!stored) {
            return err(serviceError(ErrorCodes.KV_NOT_FOUND, `Key not found: ${key}`, "kv"));
        }
        this._store.delete(fullKey);
        return ok({
            data: undefined,
            headers: this.createHeaders(stored),
        });
    }
    async head(key, options) {
        this.recordOperation("head", key, undefined, options);
        const fullKey = this.getFullKey(key, options?.prefix);
        // Check for error injection
        const injectedError = this.checkErrorInjection(fullKey, "head");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        // Check abort
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        const stored = this._store.get(fullKey);
        if (!stored) {
            return err(serviceError(ErrorCodes.KV_NOT_FOUND, `Key not found: ${key}`, "kv"));
        }
        return ok({
            data: undefined,
            headers: this.createHeaders(stored),
        });
    }
    async createSignedReadUrl(key, options) {
        this.recordOperation("createSignedReadUrl", key, undefined, options);
        const fullKey = this.getFullKey(key, options?.prefix);
        const injectedError = this.checkErrorInjection(fullKey, "createSignedReadUrl");
        if (injectedError) {
            return err(injectedError);
        }
        await this.simulateLatency();
        if (options?.signal?.aborted) {
            return err(serviceError(ErrorCodes.ABORTED, "Request aborted", "kv"));
        }
        const ticketId = `mock-${encodeURIComponent(fullKey)}`;
        const relativeUrl = `/signed/kv/${ticketId}`;
        const expiresInSeconds = options?.expiresInSeconds ??
            Math.ceil(DEFAULT_SIGNED_READ_URL_EXPIRY_MS / 1000);
        return ok({
            url: `https://mock.tinycloud.test${relativeUrl}`,
            relativeUrl,
            ticketId,
            expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        });
    }
    /**
     * Create a prefix-scoped view of this KV service.
     *
     * @param prefix - The prefix to apply to all operations
     * @returns A PrefixedKVService scoped to the prefix
     */
    withPrefix(prefix) {
        return new PrefixedKVService(this, prefix);
    }
    // ============================================================
    // Test Helpers
    // ============================================================
    /**
     * Get all recorded operations.
     */
    getOperations() {
        return [...this._operations];
    }
    /**
     * Get operations filtered by type.
     */
    getOperationsByType(type) {
        return this._operations.filter((op) => op.type === type);
    }
    /**
     * Clear recorded operations.
     */
    clearOperations() {
        this._operations = [];
    }
    /**
     * Get the in-memory store contents.
     */
    getStoreContents() {
        const result = new Map();
        for (const [key, stored] of this._store) {
            result.set(key, stored.data);
        }
        return result;
    }
    /**
     * Directly set a value in the store (bypasses operation recording).
     */
    setStoreValue(key, value) {
        this._store.set(key, this.createStoredValue(value));
    }
    /**
     * Clear the entire store.
     */
    clearStore() {
        this._store.clear();
    }
    /**
     * Add an error injection.
     */
    addErrorInjection(injection) {
        this._errorInjections.push(injection);
    }
    /**
     * Clear all error injections.
     */
    clearErrorInjections() {
        this._errorInjections = [];
    }
    /**
     * Set the simulated latency.
     */
    setLatency(ms) {
        this._latencyMs = ms;
    }
    /**
     * Get the number of items in the store.
     */
    get storeSize() {
        return this._store.size;
    }
    /**
     * Check if a key exists in the store.
     */
    hasKey(key) {
        return this._store.has(key);
    }
    // ============================================================
    // Private Helpers
    // ============================================================
    getFullKey(key, prefixOverride) {
        const prefix = prefixOverride ?? this._config.prefix ?? "";
        return prefix ? `${prefix}/${key}` : key;
    }
    createStoredValue(data, contentType) {
        return {
            data,
            contentType: contentType ?? "application/json",
            lastModified: new Date(),
            etag: `"${Date.now()}-${Math.random().toString(36).slice(2)}"`,
        };
    }
    createHeaders(stored) {
        const headersMap = new Map([
            ["etag", stored.etag],
            ["content-type", stored.contentType],
            ["last-modified", stored.lastModified.toISOString()],
            [
                "content-length",
                String(typeof stored.data === "string"
                    ? stored.data.length
                    : JSON.stringify(stored.data).length),
            ],
        ]);
        return {
            etag: stored.etag,
            contentType: stored.contentType,
            lastModified: stored.lastModified.toISOString(),
            contentLength: typeof stored.data === "string"
                ? stored.data.length
                : JSON.stringify(stored.data).length,
            get: (name) => headersMap.get(name.toLowerCase()) ?? null,
        };
    }
    recordOperation(type, key, value, options) {
        this._operations.push({
            type,
            key,
            value,
            options,
            timestamp: Date.now(),
        });
    }
    checkErrorInjection(key, operation) {
        for (let i = 0; i < this._errorInjections.length; i++) {
            const injection = this._errorInjections[i];
            // Check operation type
            if (injection.operations && !injection.operations.includes(operation)) {
                continue;
            }
            // Check pattern match
            const matches = typeof injection.pattern === "string"
                ? key === injection.pattern || key.startsWith(injection.pattern + "/")
                : injection.pattern.test(key);
            if (matches) {
                // Decrement count if specified
                if (injection.count !== undefined) {
                    injection.count--;
                    if (injection.count <= 0) {
                        this._errorInjections.splice(i, 1);
                    }
                }
                return serviceError(injection.code, injection.message, "kv");
            }
        }
        return null;
    }
    async simulateLatency() {
        if (this._latencyMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this._latencyMs));
        }
    }
}
MockKVService.serviceName = "kv";
//# sourceMappingURL=MockKVService.js.map