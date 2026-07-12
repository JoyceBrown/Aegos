# Aegos 2.9.54 FlClash Benchmark Baseline

Updated: 2026-07-12

Purpose: define the repeatable benchmark Aegos will use when comparing speed-test behavior, UI responsiveness, and result display against FlClash. This is a source-only baseline. It does not copy FlClash code, UI, icons, or assets.

## 1. Benchmark Rule

The comparison is only valid when all of these are the same:

- Same Windows machine.
- Same physical network.
- Same subscription.
- Same selected subscription profile.
- Same TUN state.
- Same system proxy state.
- Same delay-test URL family: `https://www.gstatic.com/generate_204` is the primary Aegos batch target.
- Same active competing proxy environment. If FlClash TUN is enabled while Aegos tests, record it explicitly.

If any item differs, the result is only a note, not a benchmark.

## 2. Metrics

| Metric | Aegos target | Why it matters |
|---|---|---|
| Batch speed success count | Close to FlClash under same network | Measures protocol handling and route correctness. |
| First result latency | First rows should update quickly | Users judge fluidity by first visible result, not total completion. |
| Full completion time | No large unexplained gap against FlClash | Detects scheduler or timeout waste. |
| UI responsiveness during test | Navigation and buttons remain usable | Prevents "software froze" feeling. |
| Result sync | Home and node page show the same delay/failure state | Prevents stale state and user confusion. |
| Failure reason quality | timeout/DNS/TLS/auth/protection/etc. | "Untested" is not acceptable after a test attempt. |
| No auto switch | Zero proxy switch calls during speed test | Aegos product rule. |
| Subscription switch cancellation | Old speed test cannot write into new subscription | Prevents cross-subscription pollution. |

## 3. Test Matrix

| Case | FlClash setup | Aegos setup | Required output |
|---|---|---|---|
| Same subscription, TUN off | FlClash TUN off | Aegos TUN off, system proxy optional | Success count, first result, complete time, UI notes |
| Same subscription, TUN on | FlClash TUN on | Aegos TUN off and then on | Protocols that fail under nested routing |
| SS/Trojan/VLESS/TUIC/AnyTLS mixed | Same subscription | Same subscription | Per-protocol success and failure reason |
| Rapid navigation during batch speed | Switch pages while testing | Switch pages while testing | No blocked navigation, no stuck "testing" rows |
| Subscription switch during batch speed | Switch subscription during test | Switch subscription during test | Previous run cancelled, old result ignored |
| Single-node failed test | Pick slow/bad node | Pick same node if possible | Button not frozen, failure reason visible |

## 4. Current Aegos Baseline From Audits

Current automated evidence:

- `audit:speed` verifies batch speed tests do not call proxy-switch paths.
- `audit:speed` verifies single-node speed tests only update node health and recommendation.
- `audit:speed` verifies speed-test UI remains non-blocking.
- `audit:speed` verifies home and node page result sync.
- `audit:speed` verifies failed tests keep structured reasons.
- `audit:speed` verifies profile switching cancels stale speed results.
- `smoke:interactions` covers no-switch, navigation responsiveness, and cross-page delay sync.
- `smoke:perf` covers rapid navigation stress.
- `smoke:soak` covers longer interaction stability.

Manual benchmark fields still required when comparing real FlClash:

```text
Date:
Windows build:
Aegos version:
FlClash version:
Subscription label:
TUN state:
System proxy state:
Node count:
Protocol mix:
Delay target:

FlClash:
- First result:
- Completed:
- Success:
- Failed:
- UI freeze observed:

Aegos:
- First result:
- Completed:
- Success:
- Failed:
- UI freeze observed:

Gap:
Likely cause:
Action:
```

## 5. Acceptance

Aegos may pass this baseline only when:

- Batch speed test never switches node.
- Batch speed test does not lock navigation or main buttons.
- At least first results are visible quickly and progressively.
- Failed tested nodes show a reason, not a blank "untested" state.
- Switching subscription cancels or isolates stale speed work.
- Home and node page show the same speed result state.
- Any FlClash advantage is recorded with evidence before changing Aegos.

## 6. Risks And Boundaries

- FlClash is a GPL project; Aegos may benchmark behavior and learn strategy, but must not copy code, icons, style, or assets.
- FlClash and Aegos running together can affect routing. Every benchmark must record whether FlClash TUN or system proxy is active.
- If nested routing changes protocol success, record it as environment interference, then test Aegos alone.
- Benchmark results are not permanent truth. Network conditions can change; repeat results before architecture changes.
