/**
 * MockServiceContext - Test implementation of IServiceContext
 *
 * Provides a configurable mock context for testing services
 * without network dependencies.
 */
/**
 * MockServiceContext implements IServiceContext for testing.
 *
 * Features:
 * - In-memory service registry
 * - Configurable mock invoke that returns test data
 * - Configurable mock fetch with pattern matching
 * - Event emission tracking for assertions
 * - Session state management
 *
 * @example
 * ```typescript
 * const context = new MockServiceContext({
 *   session: createMockSession(),
 *   fetchResponses: new Map([
 *     ['/invoke', { ok: true, status: 200, body: { data: 'test' } }],
 *   ]),
 * });
 *
 * const kv = new KVService({});
 * kv.initialize(context);
 * context.registerService('kv', kv);
 *
 * // Assert events were emitted
 * expect(context.getEmittedEvents('service.request')).toHaveLength(1);
 * ```
 */
export class MockServiceContext {
    constructor(config = {}) {
        this._services = new Map();
        this._eventHandlers = new Map();
        this._emittedEvents = [];
        this._abortController = new AbortController();
        this._invokeCallCount = 0;
        this._fetchCallCount = 0;
        this._session = config.session ?? null;
        this.hosts = config.hosts ?? ["https://mock.tinycloud.test"];
        this._fetchResponses = config.fetchResponses ?? new Map();
        this._defaultFetchResponse = config.defaultFetchResponse ?? {
            ok: true,
            status: 200,
            statusText: "OK",
            body: {},
        };
        this._invokeFunction = config.invoke ?? this.defaultInvoke.bind(this);
        this.retryPolicy = config.retryPolicy ?? {
            maxAttempts: 3,
            backoff: "exponential",
            baseDelayMs: 1000,
            maxDelayMs: 10000,
            retryableErrors: ["NETWORK_ERROR", "TIMEOUT"],
        };
    }
    // ============================================================
    // Session Management
    // ============================================================
    get session() {
        return this._session;
    }
    get isAuthenticated() {
        return this._session !== null;
    }
    /**
     * Set the session (test helper).
     */
    setSession(session) {
        this._session = session;
        this.emit("session.changed", { authenticated: session !== null });
        for (const service of this._services.values()) {
            service.onSessionChange(session);
        }
    }
    // ============================================================
    // Platform Dependencies
    // ============================================================
    /**
     * Default invoke implementation that returns mock headers.
     */
    defaultInvoke(session, service, path, action) {
        return {
            Authorization: `Bearer mock-token-${service}-${action}`,
            "X-Mock-Service": service,
            "X-Mock-Path": path,
            "X-Mock-Action": action,
        };
    }
    get invoke() {
        return (session, service, path, action) => {
            this._invokeCallCount++;
            return this._invokeFunction(session, service, path, action);
        };
    }
    get fetch() {
        return async (url, init) => {
            this._fetchCallCount++;
            // Find matching response
            let mockResponse = this._defaultFetchResponse;
            for (const [pattern, handler] of this._fetchResponses) {
                const matches = typeof pattern === "string"
                    ? url.includes(pattern)
                    : pattern.test(url);
                if (matches) {
                    if (typeof handler === "function") {
                        mockResponse = await handler(url, init);
                    }
                    else {
                        mockResponse = handler;
                    }
                    break;
                }
            }
            // Create mock response object
            const headers = new Map(Object.entries(mockResponse.headers ?? {}).map(([k, v]) => [
                k.toLowerCase(),
                v,
            ]));
            return {
                ok: mockResponse.ok,
                status: mockResponse.status,
                statusText: mockResponse.statusText,
                headers: {
                    get: (name) => headers.get(name.toLowerCase()) ?? null,
                },
                json: async () => mockResponse.body,
                text: async () => typeof mockResponse.body === "string"
                    ? mockResponse.body
                    : JSON.stringify(mockResponse.body),
                arrayBuffer: async () => {
                    const text = typeof mockResponse.body === "string"
                        ? mockResponse.body
                        : JSON.stringify(mockResponse.body);
                    return new TextEncoder().encode(text).buffer;
                },
                blob: async () => {
                    const text = typeof mockResponse.body === "string"
                        ? mockResponse.body
                        : JSON.stringify(mockResponse.body);
                    return new Blob([text]);
                },
            };
        };
    }
    // ============================================================
    // Service Registry
    // ============================================================
    registerService(name, service) {
        this._services.set(name, service);
    }
    unregisterService(name) {
        this._services.delete(name);
    }
    getService(name) {
        return this._services.get(name);
    }
    // ============================================================
    // Event System (Telemetry)
    // ============================================================
    emit(event, data) {
        // Record the event for assertions
        this._emittedEvents.push({
            event,
            data,
            timestamp: Date.now(),
        });
        // Notify handlers
        const handlers = this._eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                }
                catch {
                    // Swallow errors in handlers during tests
                }
            }
        }
    }
    on(event, handler) {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, new Set());
        }
        this._eventHandlers.get(event).add(handler);
        return () => {
            const handlers = this._eventHandlers.get(event);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this._eventHandlers.delete(event);
                }
            }
        };
    }
    // ============================================================
    // Lifecycle
    // ============================================================
    get abortSignal() {
        return this._abortController.signal;
    }
    /**
     * Abort all operations (test helper).
     */
    abort() {
        this._abortController.abort();
        this._abortController = new AbortController();
        for (const service of this._services.values()) {
            service.onSignOut();
        }
    }
    // ============================================================
    // Test Assertion Helpers
    // ============================================================
    /**
     * Get all emitted events.
     */
    getEmittedEvents() {
        return [...this._emittedEvents];
    }
    /**
     * Get emitted events filtered by event name.
     */
    getEmittedEventsByName(eventName) {
        return this._emittedEvents.filter((e) => e.event === eventName);
    }
    /**
     * Check if a specific event was emitted.
     */
    wasEventEmitted(eventName) {
        return this._emittedEvents.some((e) => e.event === eventName);
    }
    /**
     * Get the count of events by name.
     */
    getEventCount(eventName) {
        return this._emittedEvents.filter((e) => e.event === eventName).length;
    }
    /**
     * Clear all recorded events.
     */
    clearEmittedEvents() {
        this._emittedEvents = [];
    }
    /**
     * Get the number of invoke calls.
     */
    get invokeCallCount() {
        return this._invokeCallCount;
    }
    /**
     * Get the number of fetch calls.
     */
    get fetchCallCount() {
        return this._fetchCallCount;
    }
    /**
     * Reset call counts.
     */
    resetCallCounts() {
        this._invokeCallCount = 0;
        this._fetchCallCount = 0;
    }
    /**
     * Add a mock fetch response for a URL pattern.
     */
    addFetchResponse(pattern, response) {
        this._fetchResponses.set(pattern, response);
    }
    /**
     * Remove a mock fetch response.
     */
    removeFetchResponse(pattern) {
        this._fetchResponses.delete(pattern);
    }
    /**
     * Clear all mock fetch responses.
     */
    clearFetchResponses() {
        this._fetchResponses.clear();
    }
    /**
     * Set the default fetch response.
     */
    setDefaultFetchResponse(response) {
        this._defaultFetchResponse = response;
    }
}
//# sourceMappingURL=MockServiceContext.js.map