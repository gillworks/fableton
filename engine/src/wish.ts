// SPDX-License-Identifier: Apache-2.0
//
// Wish intake constants (issue #79), dependency-free so both the engine's
// world-api (authoritative validation) and the client's wish box (input
// cap + counter) share one source of truth for the length bounds.
export const WISH_MIN_LEN = 3;
export const WISH_MAX_LEN = 280;
