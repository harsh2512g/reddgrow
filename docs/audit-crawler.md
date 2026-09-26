# Website crawler completion audit

The final specification audit found a core implementation gap after Phase 8: the `simple` crawler factory still refused to run. The adapter is now implemented; the repository's local and existing personal-development profiles still select `fixture`. No external website, DNS resolver, or real credential was used during verification.

## Requirements and evidence

| Specification                                                                                 | Implementation                                                                                                                                                                          | Evidence                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| §§0.3, 9.1: real crawler behind the provider contract                                         | `createCrawlerProvider('simple')`, `SimpleCrawlerProvider.fetchPage` and `crawlWebsite`                                                                                                 | Fixture remains the default; adapter construction performs no I/O                                                                                   |
| §7.3: approved domain/subdomains, canonical URLs, exclude pages, prefer documentation/pricing | Exact host allowlist, query/fragment deduplication, same-origin canonical metadata, caller exclusions and prioritized bounded discovery                                                 | Injected website traversal test visits only approved preferred pages within the caller's allowance                                                  |
| §7.3: robots                                                                                  | RFC 9309 matching groups, merged exact-agent groups, wildcard/end rules, longest match, allow on ties, conservative failures and crawl delay                                            | Missing 404/410 permits crawling; 401/403/429/5xx refuses; redirect destinations recheck policy                                                     |
| §13.2: SSRF                                                                                   | DNS answer-set validation, special-address denylist, pinned socket lookup, new lookup per request and redirect, exact domains                                                           | Public/private mixed answers, DNS rebinding, IPv4 alternate encodings, mapped IPv6, metadata, IPv6 special ranges and unsafe redirects are rejected |
| §§7.3,13.2: bounded work                                                                      | 15-second request deadline, 2 MiB wire bytes, 512 KiB robots, 500k text characters, 50k DOM nodes, five redirects, two concurrent requests, 32 waiters, request spacing and Retry-After | Native HTTP adapter tests cover streamed overflow, malformed length, compression, truncation and protocol upgrades without opening sockets          |
| §§7.3,12: page limits and safe retries                                                        | Default 30 and ceiling 100 attempted pages; caller supplies remaining plan capacity; 1,000 discovery candidates and 120-second traversal budget checked between pages                   | Budget/exclusion/deduplication and partial-failure tests; existing SQL remains plan authority                                                       |
| §§0.2,13.1: never scrape Reddit                                                               | Reddit and related content domains are denied even when supplied as approved domains                                                                                                    | Reddit URL and redirect cases fail before any content request                                                                                       |
| §18: crawl observations                                                                       | Existing safe observability wrapper records `provider.crawler.page` success/failure/duration                                                                                            | No URL, remote body, DNS response or secret enters an error or metric label                                                                         |

The transport uses Node HTTP/HTTPS with an explicit pinned lookup, no shared agent, no cookies/authorization, no redirects, and TLS's normal certificate/hostname verification. HTML is parsed with pinned `parse5` 8.0.1, already present in the lockfile cache; adding it reused one package and downloaded zero. Scripts, forms and hidden text are excluded. Navigation links can be discovered without becoming knowledge text. HTML is never executed.

Robots handling follows the [Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html), with stricter same-origin redirect and unavailable-policy handling. The network boundary was checked against [Node HTTP request options](https://nodejs.org/api/http.html) and the [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries. The address policy intentionally rejects all special IPv4 ranges and limits IPv6 to non-special global unicast.

## Focused verification

Executed through the repository launcher:

```sh
./scripts/local pnpm --filter @threadsignal/crawler add parse5@8.0.1 --offline
./scripts/local pnpm exec prettier packages/crawler --write
./scripts/local pnpm --filter @threadsignal/crawler typecheck
./scripts/local pnpm --filter @threadsignal/crawler lint
./scripts/local pnpm exec vitest run packages/crawler/tests
```

Final focused results: typecheck and lint exit 0; **117/117 tests across three files passed in 606 ms**. Initial typecheck caught a Node option typing mismatch and test-spy tuple typing; initial lint caught a regex escape and misplaced suppression comment. Both were corrected before the successful rerun. No test failure was hidden.

## Activation and limitations

The simple provider needs no crawling-service key. `firecrawl` remains unsupported and fails closed; no Firecrawl dependency is required by the specification. Activating external crawling remains an explicit deployment decision, separate from implementing the adapter. The owner must provide approved customer domains and server-authorized remaining page capacity. Live DNS, actual TLS/socket behavior, robots from customer websites, deployment egress rules and full production ingestion have not been live-tested.

The adapter accepts UTF-8 HTML/plain text and deliberately does not execute JavaScript, authenticate to customer sites, decompress responses, crawl Unicode hostnames, follow nonstandard ports, or crawl binary files. Upload extraction remains the PDF/Markdown/text path. A page fetched near the end of the traversal budget may use its remaining bounded request deadline. Multiple deployed worker processes need an agreed crawl scheduling/egress policy; limits inside the adapter are per provider instance.
