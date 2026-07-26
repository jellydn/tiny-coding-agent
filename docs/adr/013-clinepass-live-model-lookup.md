# ADR-013: ClinePass — Live Models Lookup (Derived from `baseUrl`)

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** huynhdung

## Context

`ClinePassProvider` (added in PR #58) currently ships with a hand-maintained `CLINEPASS_MODEL_CAPABILITIES` table — eight `cline-pass/<id>` rows built by a `defaultClineCapabilities(modelName)` factory — that maps each curated model id to a hardcoded capability profile (`isVerified: false, source: "fallback", contextWindow: 128000, maxOutputTokens: 8192, supportsThinking: true, ...`).

The Cline API exposes a `GET /api/v1/models` endpoint that returns an OpenAI-compatible list of model ids currently served by the gateway. New model ids added upstream are not visible to tiny-coding-agent until a code change lands in the agent. The baked table is the source of truth, not a cache.

The Cline API response is the *list of model ids* — per-model capability fields are not in the payload. Cline's documentation publishes context windows and capability flags separately, and the README describes a "curated list of high-performance open-weight coding models" whose capability profile is consistent across the list.

## Decision

Replace the baked `CLINEPASS_MODEL_CAPABILITIES` table with a **live lookup** of `GET /api/v1/models` on the first call to `getCapabilities(model)` for an unknown model id. The table becomes a CDN cache, not the source of truth. New model ids added upstream appear automatically.

### Concrete behaviour

1. **First call** to `getCapabilities` for any unknown model id:
   - Fetch `GET <origin>/api/v1/models` with `Authorization: Bearer <apiKey>`. The origin is derived from the configured `baseUrl` by stripping the trailing `/v1` (Cline's chat endpoint is at `/v1/...`; the models endpoint is at `/api/v1/models` on the same origin).
   - If 200 and the model id is in the response: return `defaultClineCapabilities(model)` with `isVerified: true, source: "api"`. Cache per-id.
   - If 200 but the model id is **not** in the response: fall through to `super.getCapabilities(model)` (OpenAI-derived defaults). Cache the negative result so we don't re-fetch on every call.
   - If network error, non-200, malformed JSON, JSON parse yielding `null`, or missing `data` field: fall through to `super.getCapabilities(model)`. Do **not** cache the fallback — the next call retries the list fetch.

2. **Subsequent calls** to `getCapabilities(model)` for any model id (positive, negative, or never-fetched):
   - Per-id cache hit → O(1) return.

3. **List-fetch memoization**: the `GET /api/v1/models` promise is stored at the per-instance level. All calls in the same provider instance share one fetch. Parallel `getCapabilities` calls collapse to a single network request. On failure, the promise is cleared so the next call retries.

4. **URL construction**: `baseUrl.replace(/\/v1\/?$/, "/api/v1/models")`. String replacement (rather than `URL.origin`) preserves path prefixes — `"https://corp.proxy/clinepass/v1"` correctly maps to `"https://corp.proxy/clinepass/api/v1/models"`.

5. **Auth**: `Authorization: Bearer <apiKey>`. The apiKey comes from the provider config (which the loader populates from `CLINE_API_KEY` / `CLINEPASS_API_KEY` per ADR context).

6. **No baked fallback** — per the user spec. If the live lookup fails for every call, every model id falls through to the OpenAI-derived defaults. Adding a small baked list "just in case" would defeat the purpose of the live lookup.

### Why a uniform capability profile?

The Cline API response does not include per-model capabilities. The `defaultClineCapabilities` factory applies a single profile (`isVerified: true, source: "api", contextWindow: 128000, maxOutputTokens: 8192, all-supports=true`) to every confirmed model id. The Cline README's "curated list of high-performance open-weight coding models" framing is the heuristic that justifies uniform capabilities. A future correction to the uniform profile is a one-line change in the factory; per-id divergence would require a per-model override map.

## Consequences

### Positive

- **Upstream-driven source of truth**: a model id added by ClinePass shows up automatically on the next `getCapabilities` call. No agent release needed.
- **Smaller code surface**: the `CLINEPASS_MODEL_IDS` and `CLINEPASS_MODEL_CAPABILITIES` constants are gone. The capability profile is still centralised in `defaultClineCapabilities`, but the per-id array is deleted.
- **Cline's own README documents this approach**: the upstream `pi-clinepass-provider` repo "performs dynamic model discovery" on startup, with a baked list as fallback. Our implementation follows the same pattern, with the Cline API as primary and the OpenAI-derived defaults (rather than a baked list) as the fallback.

### Negative

- **First call latency**: the first `getCapabilities` for any model id waits for the network round-trip. After the first fetch, the per-id + per-instance caches make subsequent calls O(1).
- **No fetch timeout**: if the upstream hangs, `getCapabilities` hangs indefinitely. (The OpenAI parent inherits the same issue, so this is consistent.) A future hardening could add an `AbortSignal.timeout(5000)`.
- **No circuit-breaker**: a downed upstream produces N+ fetches per agent run (one per new model id, since the per-id cache is bypassed on failure by design). A future hardening could add a per-instance "last failure time" with a 30s cooldown.
- **Magic strings**: `"Authorization"`, `"Bearer "`, and `"/api/v1/models"` appear inline. Trivial to extract to named constants if the codebase prefers.

### Sentinel-based caching

The `if (this._modelsListPromise !== null)` post-await check is the gate for "is the per-id result safe to cache?" It relies on the `.catch(() => { this._modelsListPromise = null; })` handler in `_getModelsList` being registered before the `await` in `_isModelInLiveList` registers its own catch, so the null-clear runs first. A more robust alternative (e.g., an explicit `private _lastListFetchFailed: boolean` field) is on the table if a future refactor breaks the ordering.

## Alternatives Considered

1. **Keep the baked table, augment with a live fetch.** Rejected — duplicates state and adds a precedence rule (live vs baked). The user's spec was explicit: "skip a baked `CLINEPASS_MODEL_CAPABILITIES` table."
2. **Live fetch only, no per-id cache.** Rejected — every `getCapabilities` call would re-issue the list promise and re-resolve through `super.getCapabilities`. Wasted work for repeated lookups of the same model id.
3. **Bake + live fetch in parallel, take the more-recent answer.** Rejected — complexity not justified; the Cline API is the source of truth, not a parallel source.
4. **Add a tiny baked safety-net list of known-good model ids** alongside the live fetch. Rejected — defeats the user's "live lookup, no baked fallback" intent. If the live lookup fails AND the model id is unknown to OpenAI, we end up with the OpenAI hardcoded fallback (16k context, no thinking). This is an acceptable degradation for an unreachable upstream.
5. **Pre-fetch the model list at provider construction time** (eagerly). Rejected — defers network cost from the first `getCapabilities` call to the construction call. Both paths have one round-trip on cold start; lazy fetch keeps the construction synchronous and cheap.

## Trigger to Re-Evaluate

Re-open this ADR if any of the following become true:

- ClinePass ships per-model capability fields in their `/api/v1/models` response. The uniform `defaultClineCapabilities` profile can be replaced with per-id field mapping, eliminating the "uniform profile is a heuristic" concern.
- The fetch timeout / circuit-breaker hardening is implemented; the negatives in *Consequences* should be updated or removed accordingly.
- The live lookup latency becomes a hot path in profiling. A pre-fetch at construction (eager variant of alternative 5) becomes worth the additional startup cost.
- The Cline API URL or auth scheme changes.

## Related Decisions

- ADR-002: LLM Provider Abstraction — the wider pattern of `LLMClient` + per-provider implementations. This ADR is a within-provider pattern decision for one gateway.
- ADR-012: `GatewayOpenAIProvider` Base Class — held back by the 30% threshold. This ADR's live-lookup change does not affect that calculation (the new code still lives in `ClinePassProvider` only) but is a reminder that the abstraction question can be revisited if the cached-catalog pattern evolves.
- PR #58 follow-up commit `867f013` — the per-provider `defaultClineCapabilities` factory that this ADR preserves. The factory survives; only the `CLINEPASS_MODEL_IDS` array and the `CLINEPASS_MODEL_CAPABILITIES` table go away.

## Future Considerations

- A shared "live capability lookup" base class (analogous to the previously-considered `GatewayOpenAIProvider`) could emerge if `OpenRouterProvider` or `ZaiProvider` adopts a similar pattern. ADR-012's 30% threshold would need to be re-evaluated against the new duplication.
- If ClinePass later exposes a `GET /api/v1/models/{id}` per-model detail endpoint, the uniform `defaultClineCapabilities` profile could be replaced with per-id detail lookups (still with the same memoization pattern).
