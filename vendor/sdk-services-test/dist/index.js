/**
 * TinyCloud SDK Services - Test Utilities
 *
 * Mock implementations and test helpers for testing services
 * without network dependencies.
 *
 * @packageDocumentation
 * @module @tinycloud/sdk-services-test
 *
 * @example
 * ```typescript
 * import {
 *   createTestContext,
 *   createMockKV,
 *   createMockSession,
 *   waitForEvent,
 * } from '@tinycloud/sdk-services-test';
 *
 * // Create an authenticated test context
 * const context = createTestContext({ authenticated: true });
 *
 * // Create a mock KV service with seed data
 * const kv = createMockKV({ 'key': 'value' });
 * kv.initialize(context);
 *
 * // Test service operations
 * const result = await kv.get('key');
 * expect(result.ok).toBe(true);
 * ```
 */
// Mock implementations
export { MockServiceContext, } from "./MockServiceContext.js";
export { MockKVService, } from "./MockKVService.js";
// Test helpers
export { createMockSession, createTestContext, createMockKV, waitForEvent, waitForEvents, mockOkResponse, mockErrorResponse, delayedResponse, sequenceResponses, wasOperationRecorded, setupMockKV, } from "./helpers.js";
//# sourceMappingURL=index.js.map
