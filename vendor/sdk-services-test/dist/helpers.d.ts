/**
 * Test Utilities for SDK Services
 *
 * Factory functions and helpers for creating test fixtures.
 */
import type { ServiceSession } from "@tinycloud/sdk-services";
import { MockServiceContext, MockServiceContextConfig, MockFetchResponse } from "./MockServiceContext";
import { MockKVService, MockKVServiceConfig } from "./MockKVService";
/**
 * Options for creating a test context.
 */
export interface CreateTestContextOptions extends MockServiceContextConfig {
    /** Whether to include a default authenticated session */
    authenticated?: boolean;
    /** Custom session data */
    sessionOverrides?: Partial<ServiceSession>;
}
/**
 * Create a mock ServiceSession for testing.
 *
 * @param overrides - Optional overrides for session fields
 * @returns A mock ServiceSession
 *
 * @example
 * ```typescript
 * const session = createMockSession();
 * const customSession = createMockSession({
 *   spaceId: 'space:custom-id',
 * });
 * ```
 */
export declare function createMockSession(overrides?: Partial<ServiceSession>): ServiceSession;
/**
 * Create a MockServiceContext with sensible defaults for testing.
 *
 * @param options - Configuration options
 * @returns A configured MockServiceContext
 *
 * @example
 * ```typescript
 * // Create an authenticated context
 * const context = createTestContext({ authenticated: true });
 *
 * // Create with custom fetch responses
 * const context = createTestContext({
 *   authenticated: true,
 *   fetchResponses: new Map([
 *     ['/invoke', { ok: true, status: 200, body: { data: 'test' } }],
 *   ]),
 * });
 * ```
 */
export declare function createTestContext(options?: CreateTestContextOptions): MockServiceContext;
/**
 * Create a MockKVService with initial data.
 *
 * @param initialData - Key-value pairs to seed the store
 * @param config - Additional configuration
 * @returns A configured MockKVService
 *
 * @example
 * ```typescript
 * const kv = createMockKV({
 *   'user/settings': { theme: 'dark' },
 *   'user/profile': { name: 'Alice' },
 * });
 *
 * // With latency simulation
 * const kv = createMockKV(
 *   { 'key': 'value' },
 *   { latencyMs: 50 }
 * );
 * ```
 */
export declare function createMockKV(initialData?: Record<string, unknown>, config?: Omit<MockKVServiceConfig, "initialData">): MockKVService;
/**
 * Wait for a specific event to be emitted from a context.
 *
 * @param context - The MockServiceContext to listen on
 * @param eventName - The event name to wait for
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with the event data
 *
 * @example
 * ```typescript
 * // Wait for session change event
 * const eventPromise = waitForEvent(context, 'session.changed');
 * context.setSession(createMockSession());
 * const eventData = await eventPromise;
 * expect(eventData.authenticated).toBe(true);
 * ```
 */
export declare function waitForEvent(context: MockServiceContext, eventName: string, timeoutMs?: number): Promise<unknown>;
/**
 * Wait for multiple events to be emitted.
 *
 * @param context - The MockServiceContext to listen on
 * @param eventName - The event name to wait for
 * @param count - Number of events to wait for
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with array of event data
 *
 * @example
 * ```typescript
 * // Wait for 3 service requests
 * const eventsPromise = waitForEvents(context, 'service.request', 3);
 * await kv.get('key1');
 * await kv.get('key2');
 * await kv.get('key3');
 * const events = await eventsPromise;
 * expect(events).toHaveLength(3);
 * ```
 */
export declare function waitForEvents(context: MockServiceContext, eventName: string, count: number, timeoutMs?: number): Promise<unknown[]>;
/**
 * Create a mock fetch response for success scenarios.
 *
 * @param body - Response body
 * @param headers - Optional response headers
 * @returns MockFetchResponse
 *
 * @example
 * ```typescript
 * const response = mockOkResponse({ keys: ['a', 'b'] });
 * context.addFetchResponse('/invoke', response);
 * ```
 */
export declare function mockOkResponse(body: unknown, headers?: Record<string, string>): MockFetchResponse;
/**
 * Create a mock fetch response for error scenarios.
 *
 * @param status - HTTP status code
 * @param body - Error body
 * @param statusText - Optional status text
 * @returns MockFetchResponse
 *
 * @example
 * ```typescript
 * const response = mockErrorResponse(404, { error: 'Not found' });
 * context.addFetchResponse('/invoke', response);
 * ```
 */
export declare function mockErrorResponse(status: number, body?: unknown, statusText?: string): MockFetchResponse;
/**
 * Create a delayed mock fetch handler for testing latency.
 *
 * @param response - The response to return after delay
 * @param delayMs - Delay in milliseconds
 * @returns Mock fetch handler function
 *
 * @example
 * ```typescript
 * context.addFetchResponse(
 *   '/invoke',
 *   delayedResponse(mockOkResponse({ data: 'test' }), 100)
 * );
 * ```
 */
export declare function delayedResponse(response: MockFetchResponse, delayMs: number): () => Promise<MockFetchResponse>;
/**
 * Create a sequence of mock responses that cycle through.
 *
 * @param responses - Array of responses to cycle through
 * @returns Mock fetch handler function
 *
 * @example
 * ```typescript
 * // First call returns error, subsequent calls succeed
 * context.addFetchResponse(
 *   '/invoke',
 *   sequenceResponses([
 *     mockErrorResponse(503, 'Temporarily unavailable'),
 *     mockOkResponse({ data: 'success' }),
 *   ])
 * );
 * ```
 */
export declare function sequenceResponses(responses: MockFetchResponse[]): () => MockFetchResponse;
/**
 * Assert that an operation was recorded with specific properties.
 *
 * @param kv - The MockKVService to check
 * @param expected - Expected operation properties
 * @returns Whether a matching operation was found
 *
 * @example
 * ```typescript
 * await kv.put('key', 'value');
 * expect(wasOperationRecorded(kv, { type: 'put', key: 'key' })).toBe(true);
 * ```
 */
export declare function wasOperationRecorded(kv: MockKVService, expected: Partial<{
    type: "get" | "put" | "list" | "delete" | "head";
    key: string;
    value: unknown;
}>): boolean;
/**
 * Setup a MockKVService with a MockServiceContext.
 *
 * @param kvConfig - MockKVService configuration
 * @param contextConfig - MockServiceContext configuration
 * @returns Object with initialized kv and context
 *
 * @example
 * ```typescript
 * const { kv, context } = setupMockKV(
 *   { initialData: { 'key': 'value' } },
 *   { authenticated: true }
 * );
 *
 * const result = await kv.get('key');
 * expect(result.ok).toBe(true);
 * ```
 */
export declare function setupMockKV(kvConfig?: MockKVServiceConfig, contextConfig?: CreateTestContextOptions): {
    kv: MockKVService;
    context: MockServiceContext;
};
//# sourceMappingURL=helpers.d.ts.map