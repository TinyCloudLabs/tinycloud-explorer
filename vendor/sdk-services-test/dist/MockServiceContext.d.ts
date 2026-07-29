/**
 * MockServiceContext - Test implementation of IServiceContext
 *
 * Provides a configurable mock context for testing services
 * without network dependencies.
 */
import type { IServiceContext, IService, ServiceSession, RetryPolicy, InvokeFunction, FetchFunction, FetchRequestInit, EventHandler } from "@tinycloud/sdk-services";
/**
 * Recorded event with timestamp for assertion.
 */
export interface RecordedEvent {
    event: string;
    data: unknown;
    timestamp: number;
}
/**
 * Mock fetch response configuration.
 */
export interface MockFetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    body?: unknown;
}
/**
 * Mock fetch handler type.
 * Can return a response directly or a function for dynamic responses.
 */
export type MockFetchHandler = MockFetchResponse | ((url: string, init?: FetchRequestInit) => MockFetchResponse | Promise<MockFetchResponse>);
/**
 * Configuration for MockServiceContext.
 */
export interface MockServiceContextConfig {
    /** Initial session state */
    session?: ServiceSession | null;
    /** List of host URLs */
    hosts?: string[];
    /** Custom invoke function */
    invoke?: InvokeFunction;
    /** Default mock fetch responses by URL pattern */
    fetchResponses?: Map<string | RegExp, MockFetchHandler>;
    /** Default response for unmatched URLs */
    defaultFetchResponse?: MockFetchResponse;
    /** Retry policy configuration */
    retryPolicy?: RetryPolicy;
}
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
export declare class MockServiceContext implements IServiceContext {
    private _session;
    private _services;
    private _eventHandlers;
    private _emittedEvents;
    private _abortController;
    private _fetchResponses;
    private _defaultFetchResponse;
    private _invokeCallCount;
    private _fetchCallCount;
    private _invokeFunction;
    readonly hosts: string[];
    readonly retryPolicy: RetryPolicy;
    constructor(config?: MockServiceContextConfig);
    get session(): ServiceSession | null;
    get isAuthenticated(): boolean;
    /**
     * Set the session (test helper).
     */
    setSession(session: ServiceSession | null): void;
    /**
     * Default invoke implementation that returns mock headers.
     */
    private defaultInvoke;
    get invoke(): InvokeFunction;
    get fetch(): FetchFunction;
    registerService(name: string, service: IService): void;
    unregisterService(name: string): void;
    getService<T extends IService>(name: string): T | undefined;
    emit(event: string, data: unknown): void;
    on(event: string, handler: EventHandler): () => void;
    get abortSignal(): AbortSignal;
    /**
     * Abort all operations (test helper).
     */
    abort(): void;
    /**
     * Get all emitted events.
     */
    getEmittedEvents(): RecordedEvent[];
    /**
     * Get emitted events filtered by event name.
     */
    getEmittedEventsByName(eventName: string): RecordedEvent[];
    /**
     * Check if a specific event was emitted.
     */
    wasEventEmitted(eventName: string): boolean;
    /**
     * Get the count of events by name.
     */
    getEventCount(eventName: string): number;
    /**
     * Clear all recorded events.
     */
    clearEmittedEvents(): void;
    /**
     * Get the number of invoke calls.
     */
    get invokeCallCount(): number;
    /**
     * Get the number of fetch calls.
     */
    get fetchCallCount(): number;
    /**
     * Reset call counts.
     */
    resetCallCounts(): void;
    /**
     * Add a mock fetch response for a URL pattern.
     */
    addFetchResponse(pattern: string | RegExp, response: MockFetchHandler): void;
    /**
     * Remove a mock fetch response.
     */
    removeFetchResponse(pattern: string | RegExp): void;
    /**
     * Clear all mock fetch responses.
     */
    clearFetchResponses(): void;
    /**
     * Set the default fetch response.
     */
    setDefaultFetchResponse(response: MockFetchResponse): void;
}
//# sourceMappingURL=MockServiceContext.d.ts.map