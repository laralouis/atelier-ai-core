
"""
ATELIER AI – External Research API
Version 0.1

Searches scientific publications using:
- OpenAlex
- Crossref

No API key required for basic requests.
"""

import json
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


OPENALEX_URL = "https://api.openalex.org/works"
CROSSREF_URL = "https://api.crossref.org/works"

MAX_QUERY_LENGTH = 300
MAX_RESULTS = 5
TIMEOUT = 12


def send_request(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ATELIER-AI/0.1 (educational research)",
            "Accept": "application/json"
        }
    )

    with urllib.request.urlopen(
        request,
        timeout=TIMEOUT
    ) as response:
        return json.loads(response.read().decode("utf-8"))


def reconstruct_abstract(inverted_index):
    if not inverted_index:
        return ""

    words = {}

    for word, positions in inverted_index.items():
        for position in positions:
            words[position] = word

    return " ".join(
        words[position]
        for position in sorted(words)
    )


def search_openalex(query, limit):
    params = {
        "search": query,
        "per-page": limit,
        "select": (
            "id,doi,title,publication_year,"
            "authorships,abstract_inverted_index,"
            "primary_location"
        )
    }

    url = OPENALEX_URL + "?" + urllib.parse.urlencode(params)
    data = send_request(url)

    results = []

    for item in data.get("results", []):
        authors = []

        for authorship in item.get("authorships", [])[:4]:
            author = authorship.get("author", {})
            name = author.get("display_name")

            if name:
                authors.append(name)

        location = item.get("primary_location") or {}
        source = location.get("source") or {}

        results.append({
            "title": item.get("title") or "Untitled",
            "year": item.get("publication_year"),
            "authors": authors,
            "abstract": reconstruct_abstract(
                item.get("abstract_inverted_index")
            ),
            "doi": item.get("doi"),
            "url": item.get("doi") or item.get("id"),
            "publisher": source.get("display_name"),
            "provider": "OpenAlex"
        })

    return results


def search_crossref(query, limit):
    params = {
        "query.bibliographic": query,
        "rows": limit,
        "select": (
            "DOI,title,author,published,"
            "publisher,URL,type"
        )
    }

    url = CROSSREF_URL + "?" + urllib.parse.urlencode(params)
    data = send_request(url)

    results = []

    for item in data.get("message", {}).get("items", []):
        titles = item.get("title") or []

        if not titles:
            continue

        authors = []

        for author in item.get("author", [])[:4]:
            name = " ".join(
                part for part in [
                    author.get("given"),
                    author.get("family")
                ] if part
            )

            if name:
                authors.append(name)

        date_parts = (
            item.get("published", {})
            .get("date-parts", [[]])[0]
        )

        year = date_parts[0] if date_parts else None
        doi = item.get("DOI")

        results.append({
            "title": titles[0],
            "year": year,
            "authors": authors,
            "abstract": "",
            "doi": doi,
            "url": (
                "https://doi.org/" + doi
                if doi else item.get("URL")
            ),
            "publisher": item.get("publisher"),
            "provider": "Crossref"
        })

    return results


def search_research(query):
    results = []
    errors = []

    for provider in [search_openalex, search_crossref]:
        try:
            results.extend(
                provider(query, MAX_RESULTS)
            )
        except Exception as error:
            errors.append({
                "provider": provider.__name__,
                "message": str(error)[:200]
            })

    # Remove duplicate DOI records
    unique = {}
    for item in results:
        key = (
            item.get("doi")
            or item.get("url")
            or item.get("title")
        )

        if key and key not in unique:
            unique[key] = item

    return {
        "results": list(unique.values()),
        "errors": errors
    }


class handler(BaseHTTPRequestHandler):

    def send_json(self, status, data):
        body = json.dumps(
            data,
            ensure_ascii=False
        ).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )
        self.send_header(
            "Access-Control-Allow-Origin",
            "*"
        )
        self.send_header(
            "Access-Control-Allow-Methods",
            "POST, OPTIONS"
        )
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type"
        )
        self.send_header(
            "Content-Length",
            str(len(body))
        )
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_json(200, {"ok": True})

    def do_POST(self):
        try:
            length = int(
                self.headers.get("Content-Length", 0)
            )

            if length <= 0 or length > 10000:
                self.send_json(400, {
                    "error": "Invalid request size."
                })
                return

            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8"))

            query = str(
                data.get("query", "")
            ).strip()

            if not query:
                self.send_json(400, {
                    "error": "A search query is required."
                })
                return

            if len(query) > MAX_QUERY_LENGTH:
                self.send_json(400, {
                    "error": "Search query is too long."
                })
                return

            result = search_research(query)

            self.send_json(200, {
                "status": "ok",
                "query": query,
                "results": result["results"],
                "errors": result["errors"],
                "notice": (
                    "Search results are references, "
                    "not independently verified evidence."
                )
            })

        except json.JSONDecodeError:
            self.send_json(400, {
                "error": "Invalid JSON."
            })

        except Exception:
            self.send_json(500, {
                "error": "Research service temporarily unavailable."
            })
