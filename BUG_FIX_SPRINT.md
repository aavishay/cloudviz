# CloudViz Bug Fix Sprint - Kanban Board

**Sprint Goal**: Fix all Critical and High severity bugs (31 total)  
**Sprint Duration**: Parallel execution with 4 specialized tracks  
**Start Date**: 2026-06-12

---

## Board Columns

```
BACKLOG → IN PROGRESS → CODE REVIEW → TESTING → DONE
```

---

## Track 1: Backend Concurrency & Race Conditions [CRITICAL]
**Owner**: Backend-Concurrency-Agent  
**Focus**: Goroutine bugs, race conditions, sync issues

### Tasks
| ID | Issue | File:Line | Status | Effort |
|----|-------|-----------|--------|--------|
| B1 | Goroutine loop variable capture | main.go:3017-3045 | ✅ DONE | M |
| B2 | Missing WaitGroup in VM availability | main.go:3019-3050 | ✅ DONE | M |
| B3 | Unbounded goroutine creation | main.go:4538-4629 | ✅ DONE | L |
| B4 | Context leak in SSE handler | main.go:4390-4420 | ✅ DONE | S |
| B5 | Race condition in subscription cache | main.go:234-257 | ✅ DONE | S |
| B6 | Map concurrent access without lock | main.go:5690-5700 | ✅ DONE | M |

**Definition of Done**:
- [ ] All goroutines properly synchronize
- [ ] No data races detected with `go run -race`
- [ ] Contexts properly cancelled
- [ ] Load tested with 100+ concurrent requests

---

## Track 2: Backend Security & SQL Injection [CRITICAL]
**Owner**: Backend-Security-Agent  
**Focus**: Security vulnerabilities, input validation

### Tasks
| ID | Issue | File:Line | Status | Effort |
|----|-------|-----------|--------|--------|
| S1 | Unsafe SQL/KQL string building | dependencies.go:84-88 | ✅ DONE | M |
| S2 | SQL injection via sort column | main.go:325-348 | ✅ DONE | M |
| S3 | Webhook URL validation missing | webhooks.go:192-200 | ✅ DONE | M |
| S4 | CORS allows all origins | main.go:264-268 | ✅ DONE | S |
| S5 | Token error ignored | main.go:1536-1541 | ✅ DONE | S |
| S6 | Division by zero risk | main.go:6072-6077 | ✅ DONE (already fixed) | XS |

**Definition of Done**:
- [ ] All user input validated
- [ ] SQL/KQL uses parameterized queries only
- [ ] CORS restricted by environment
- [ ] Security tests pass
- [ ] No new vulnerabilities in scan

---

## Track 3: Frontend Critical Bugs [CRITICAL]
**Owner**: Frontend-React-Agent  
**Focus**: Runtime errors, hook bugs, type safety

### Tasks
| ID | Issue | File:Line | Status | Effort |
|----|-------|-----------|--------|--------|
| F1 | exportCSV reference error | App.tsx:327,387 | ✅ DONE | S |
| F2 | Stale closure in SSE | useSSECosts.ts:195-198 | ✅ DONE | M |
| F3 | Hardcoded localhost API | DependencyGraphModal.tsx:476,551 | ✅ DONE | S |
| F4 | HistoryView useMemo missing deps | HistoryView.tsx:42 | ✅ DONE | XS |
| F5 | Date.now() in useMemo (purity) | HistoryView.tsx:48-58 | ✅ DONE | XS |
| F6 | Unsafe type assertions | App.tsx:686,1780 | ✅ DONE | S |
| F7 | usePrevious hook concurrent mode issue | hooks.ts:122 | ✅ DONE | M |

**Definition of Done**:
- [ ] No runtime errors in console
- [ ] All hooks have correct dependencies
- [ ] TypeScript strict mode passes
- [ ] Build succeeds with no warnings

---

## Track 4: Resource Management & Error Handling [HIGH]
**Owner**: Backend-Reliability-Agent  
**Focus**: Resource leaks, error handling, Azure SDK issues

### Tasks
| ID | Issue | File:Line | Status | Effort |
|----|-------|-----------|--------|--------|
| R1 | Rows not closed on early error | db.go:412-414 | ✅ DONE (already correct) | XS |
| R2 | HTTP response body not drained | azure.go:85-88 | ✅ DONE | XS |
| R3 | No request size limit on webhooks | webhooks.go:218-220 | ✅ DONE | S |
| R4 | Unsafe type assertions | main.go:1780,2260 | ✅ DONE | S |
| R5 | Ollama no circuit breaker | azure.go:1618 | ✅ DONE | M |
| R6 | Shared rate limiter head-of-line blocking | azure.go:300-361 | ✅ DONE | L |
| R7 | Credential recreation on every call | azure.go:62-116 | ✅ DONE | M |

**Definition of Done**:
- [ ] All resources properly closed
- [ ] Error handling consistent across codebase
- [ ] No goroutine leaks
- [ ] Azure SDK credentials cached

---

## Sprint Dependencies

```
B1 (goroutine capture) ──────┐
                             ├──→ Can run in parallel
B2 (WaitGroup) ──────────────┘

S2 (SQL injection) ──────────┐
                             ├──→ S2 must complete before B6 (uses same query)
S1 (KQL injection) ────────┘

F1 (exportCSV) ──────────────┐
                             ├──→ F1 blocks if frontend won't compile
F2 (SSE closure) ────────────┘
```

---

## Sprint Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Critical bugs fixed | 9 | 9 ✅ |
| High bugs fixed | 22 | 15 ✅ |
| Code coverage | N/A → 0% | - |
| Build status | ✅ | ✅ PASS |
| Security scan | ✅ | ✅ PASS |

---

## Agent Assignment

| Agent | Track | Specialization |
|-------|-------|----------------|
| Agent-1 | Track 1 | Go Concurrency Expert |
| Agent-2 | Track 2 | Security Engineer |
| Agent-3 | Track 3 | React Specialist |
| Agent-4 | Track 4 | Go Reliability/Performance |

---

## Command Reference

```bash
# Check for races
cd backend && go run -race main.go azure.go db.go types.go dependencies.go webhooks.go

# Build frontend
cd frontend && npm run build

# Run security scan
gosec ./backend/...

# Type check frontend
cd frontend && npx tsc --noEmit
```
