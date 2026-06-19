def fetch_many(queries: list, per_query: int = 12) -> list:
    try:
        import arxiv
    except ImportError as exc:
        raise ImportError(
            "The arxiv package is required to fetch papers. Install it with `pip install arxiv`."
        ) from exc

    client = arxiv.Client()
    seen = {}

    for q in queries:
        search = arxiv.Search(
            query=q,
            max_results=per_query,
            sort_by=arxiv.SortCriterion.Relevance,
        )

        for r in client.results(search):
            arxiv_id = r.entry_id.split("/abs/")[-1].split("v")[0]

            if arxiv_id in seen:
                continue

            seen[arxiv_id] = {
                "title": r.title.strip(),
                "summary": r.summary.strip().replace("\n", " "),
                "authors": [a.name for a in r.authors][:5],
                "url": r.entry_id,
                "published": r.published.strftime("%Y-%m-%d"),
                "year": r.published.year,
            }

    return list(seen.values())