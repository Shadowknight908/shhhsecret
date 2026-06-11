import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';

// ── In-page log buffer (for mobile-accessible log viewer) ────────────────────
const LOG_BUFFER_MAX = 400;
const _logBuffer = [];
const _logSubscribers = new Set();

function _ts() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function _serialize(data) {
    if (data === undefined) return '';
    if (data instanceof Error) return ` — ${data.message}`;
    try {
        return ' ' + JSON.stringify(data);
    } catch {
        return ' ' + String(data);
    }
}

function _push(level, msg, data) {
    const entry = `[${_ts()}] ${level} ${msg}${_serialize(data)}`;
    _logBuffer.push(entry);
    if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
    for (const fn of _logSubscribers) {
        try {
            fn(entry);
        } catch {
            /* subscriber errors must not break logging */
        }
    }
}

/** Return a copy of the current log buffer. */
export function getLogBuffer() {
    return [..._logBuffer];
}

/** Clear the log buffer and notify subscribers. */
export function clearLogBuffer() {
    _logBuffer.length = 0;
    for (const fn of _logSubscribers) {
        try {
            fn(null);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Subscribe to new log entries.
 * @param {(entry: string | null) => void} fn - Called with new entry string, or null on clear.
 * @returns {() => void} Unsubscribe function.
 */
export function subscribeToLogs(fn) {
    _logSubscribers.add(fn);
    return () => _logSubscribers.delete(fn);
}

// ── Loggers ──────────────────────────────────────────────────────────────────

/**
 * Debug-only log. Hidden unless settings.debugMode is true.
 * @param {string} msg
 * @param {unknown} [data]
 */
export function logDebug(msg, data) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    if (!settings?.debugMode) return;
    _push('DBG', msg, data);
    const c = getDeps().console;
    if (data !== undefined) {
        c.log(`[OpenVault] ${msg}`, data);
    } else {
        c.log(`[OpenVault] ${msg}`);
    }
}

/**
 * Always-visible info log. Use for rare lifecycle milestones only.
 * @param {string} msg
 * @param {unknown} [data]
 */
export function logInfo(msg, data) {
    _push('INF', msg, data);
    const c = getDeps().console;
    if (data !== undefined) {
        c.log(`[OpenVault] ${msg}`, data);
    } else {
        c.log(`[OpenVault] ${msg}`);
    }
}

/**
 * Always-visible warning. Recovered errors, edge-case fallbacks.
 * @param {string} msg
 * @param {unknown} [data]
 */
export function logWarn(msg, data) {
    _push('WRN', msg, data);
    const c = getDeps().console;
    if (data !== undefined) {
        c.warn(`[OpenVault] ${msg}`, data);
    } else {
        c.warn(`[OpenVault] ${msg}`);
    }
}

/**
 * Always-visible error log with optional error object and context.
 * @param {string} msg - Human description of what failed
 * @param {Error} [error] - The caught error object
 * @param {Record<string, unknown>} [context] - Debugging state (counts, model names, truncated inputs)
 */
export function logError(msg, error, context) {
    _push('ERR', msg, error);
    const c = getDeps().console;
    c.error(`[OpenVault] ${msg}`);
    if (error) {
        c.error(error);
    }
    if (context) {
        const group = c.groupCollapsed?.bind(c) ?? c.log.bind(c);
        const groupEnd = c.groupEnd?.bind(c) ?? (() => {});
        group('[OpenVault] Error context');
        c.log(context);
        groupEnd();
    }
}

/**
 * Log LLM request/response to console.
 *
 * Behavior:
 * - requestLogging DISABLED (default): Short debug stats for monitoring
 * - requestLogging ENABLED: Full request/response for prompt tuning
 *
 * Uses console.groupCollapsed for clean F12 experience.
 * @param {string} label - Context label (e.g., "Extraction")
 * @param {Object} data - { messages, maxTokens, profileId, response?, error? }
 */
export function logRequest(label, data) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const requestLoggingEnabled = settings?.requestLogging ?? false;

    const isError = !!data.error;
    const prefix = isError ? '❌' : '✅';
    const c = getDeps().console;
    const group = c.groupCollapsed ? c.groupCollapsed.bind(c) : c.log.bind(c);
    const groupEnd = c.groupEnd ? c.groupEnd.bind(c) : () => {};

    if (isError) {
        // Always show full verbose output for failures (regardless of setting)
        group(`[OpenVault] ${prefix} ${label} — FAILED`);
        c.log('Profile:', data.profileId);
        c.log('Max Tokens:', data.maxTokens);
        c.log('Messages:', data.messages);
        if (data.response !== undefined) {
            c.log('Response:', data.response);
        }
        c.error('Error:', data.error);
        if (data.error.cause) {
            c.error('Caused by:', data.error.cause);
        }
        groupEnd();
        return;
    }

    // Success case: behavior depends on requestLogging setting
    if (requestLoggingEnabled) {
        // FULL OUTPUT: Show complete request/response for prompt tuning
        const responseLength = typeof data.response === 'string' ? data.response.length : 0;
        const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
        group(`[OpenVault] ✅ ${label} — FULL (${responseLength} chars, ${messageCount} messages)`);
        c.log('Profile:', data.profileId);
        c.log('Max Tokens:', data.maxTokens);
        c.log('Messages:', data.messages);
        c.log('Response:', data.response);
        groupEnd();
    } else {
        // SHORT STATS: Compact summary for monitoring (default behavior)
        const responseLength = typeof data.response === 'string' ? data.response.length : 0;
        const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
        group(`[OpenVault] ✅ ${label} — OK (${responseLength} chars, ${messageCount} messages)`);
        c.log('Profile:', data.profileId);
        c.log('Max Tokens:', data.maxTokens);
        groupEnd();
    }
}
