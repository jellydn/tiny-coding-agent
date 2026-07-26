# ADR-012: `GatewayOpenAIProvider` Base Class — Held Back by the 30% Threshold

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** huynhdung

## Context

A recurring pattern in `src/providers/` is the "OpenAI-shaped gateway with a baked catalog": a provider that extends `OpenAIProvider`, overrides `getCapabilities` to consult a hardcoded / catalog-sourced capability table, caches the result, and falls through to the inherited OpenAI defaults for unknown model ids. The chat/stream paths are inherited unchanged from `OpenAIProvider` (they already delegate to `openai-protocol.ts`).

The proposed simplification was to extract a `GatewayOpenAIProvider` base class that brokers the cache + bakes the catalog-loading pattern, leaving each subclass to provide only its `resolveCapabilities(model)` implementation. The simplification was gated behind a 30% duplication threshold: if the net savings (after subtracting the size of the base class itself) do not exceed 30% of the candidate providers' class-body LOC, do not extract.

## Decision

**Keep the providers inline.** The duplicated pattern is too small to justify the new abstraction layer. See the *Calculation* subsection below for the numbers.

## Roster of Candidates

The user prompt listed `OpenRouterProvider`, `ClinePassProvider`, and "any other OpenAI-shaped gateway with a baked catalog." Audit:

| Provider | Extends `OpenAIProvider`? | Has a baked catalog? | Has a capability cache? | Candidate? |
| --- | --- | --- | --- | --- |
| `OpenRouterProvider` | yes | yes (models.dev "openrouter") | yes | **yes** |
| `ClinePassProvider` | yes | yes (hardcoded `CLINEPASS_MODEL_CAPABILITIES`) | yes | **yes** |
| `ZaiProvider` | yes | yes (models.dev "zai" + hardcoded GLM-4.x map) | yes | **yes** |
| `OpenCodeProvider` | yes | no (it strips an `opencode/` prefix and delegates to super) | no | no — different abstraction |
| `OllamaCloudProvider` | no (uses `OllamaProvider` via composition) | no (no capability override) | no | no — different base class |

Three providers qualify. The base class would be exercised by `OpenRouterProvider`, `ClinePassProvider`, and `ZaiProvider`.

## Calculation

Per-provider class-body LOC (excluding interface declarations, config interfaces, `import` statements, and the hardcoded catalog data itself — that data is provider-specific and would not move to the base class):

| Provider | Class body LOC | `getCapabilities` LOC | `resolveCapabilities` body if extracted | Lines saved per provider |
| --- | --- | --- | --- | --- |
| `OpenRouterProvider` | 18 | 12 | 4 | 8 |
| `ClinePassProvider` | 22 | 12 | 3 | 9 |
| `ZaiProvider` | 31 | 25 | 16 | 9 |
| **Total** | **71** | | | **26** |

LOC counts above **exclude** JSDoc comments, blank lines, and the `ClinePassProvider.getResolvedBaseUrl()` method (which is testing scaffolding shipped in commit `867f013`). They **include** the class declaration, the constructor body, and the `getCapabilities` body. The rule is rendered explicitly so a future engineer re-evaluating the threshold can count the same way.

A `GatewayOpenAIProvider` base class implementing the cache + abstract `resolveCapabilities` + super fallback, plus a constructor that accepts the base URL, is ~14 lines including imports and exports.

**Net savings:** 26 − 14 = **12 lines**.
**Saved fraction of provider LOC:** 12 / 71 ≈ **17%**.
**Threshold:** 30%.
**Verdict:** 17% < 30% → do not extract.

### Why 30%?

The 30% threshold is a team convention established in this ADR; it is not derived from external literature. It is a conservative default — a savings fraction below 30% is unlikely to outweigh the cost of the new abstraction layer, the indirection through `super`, the cognitive load of an additional class, and the test-surface area of the new abstract method. The threshold is explicit so future engineers can recompute against the same baseline and (if appropriate) revisit the value rather than treating it as fixed.

## Consequences

### Positive

- One fewer abstraction layer to understand and maintain.
- Per-provider diffs stay local; a change to one cached-catalog provider does not risk every other gateway.
- The "future gateway" cost remains low because each newcomer copies a five-line idiom that the existing three providers already demonstrate.

### Negative

- The cache-check-then-catalog-then-super pattern is repeated in three providers. A future contributor adding a fourth gateway will copy the pattern, and any drift (e.g., cache key normalization, evolution of the `super.getCapabilities` fallback) has to be applied four times.
- The capability cache field is declared three times with three different `_nameCapabilitiesCache` names — a minor naming inconsistency that the base class would have eliminated.

### Mitigations Already in Place

Commit `867f013` (`refactor(providers): extract ClinePass capability factory + harden tests`) extracted a `defaultClineCapabilities(modelName)` factory inside `ClinePassProvider` so that the eight `cline-pass/<id>` rows share a single source of truth. This is the largest single chunk of repetition *within* a provider and has been collapsed without introducing a new module. The pattern is reusable: any provider that needs to build a uniform table from a list of model ids can copy the factory idiom.

## Alternatives Considered

1. **Extract the base class anyway.** Rejected by the 30% threshold. The added abstraction layer (imported abstract class, virtual method, indirection through `super`) outweighs the 12-line savings.
2. **Extract just the cache as a typed helper.** Private `_capabilitiesCache: Map<string, ModelCapabilities>` could live in a tiny utility module. The cache is one line of declaration per provider plus three lines of use; the savings are negligible and the helper adds a new module for marginal benefit.
3. **Promote the `getModelCapabilitiesFromCatalog` lookup to a base-class method.** It is already a free function in `src/providers/models-dev.ts` — the providers call it directly. No further consolidation is needed.
4. **Defer until a fourth gateway lands.** A new provider that mirrors the pattern would push the candidate count to 4, raising the saved fraction toward ~22%. Still below threshold. See *Trigger to Re-Evaluate*.

## Trigger to Re-Evaluate

Re-open this ADR if **any** of the following become true:

- A fourth provider joins the candidate roster **and** the new provider's resolver looks materially different from the existing three (e.g., it requires network introspection, async catalog fetch, or a different cache invalidation policy). At that point, the abstraction that worked for 3 copy-paste providers may not fit the 4th.
- The cache or fall-through pattern needs to change (e.g., add a TTL, support hot-reload of the catalog, or expose cache stats). Three places to update is the smell threshold; four or more is the trigger.
- The team explicitly revisits the 30% threshold value (a procedural trigger, not a code-driven one). The ADR is reopened to reconsider the threshold itself.

## Related Decisions

- ADR-002: LLM Provider Abstraction — the wider pattern of `LLMClient` + per-provider implementations. This ADR is a within-provider pattern decision.
- Commit `867f013` — the partial DRY win inside `ClinePassProvider` (per-provider factory, not a cross-provider base class).

## Future Considerations

- A future "live capability lookup" approach (replacing the baked catalog with a `GET /v1/models` request) would change the shape of `resolveCapabilities` enough to warrant revisiting the abstraction.
- The caching layer could move to a shared `CapabilityCache` type but, as noted in *Alternatives Considered* #2, the savings are negligible.
