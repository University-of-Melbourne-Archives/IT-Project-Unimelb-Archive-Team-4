"""How long a browser may keep what the installed app's site serves: the page itself is checked again each time, so an update
shows at once; the built assets, named by their contents, are kept; the API's answers keep their own."""
import importlib


def site(monkeypatch):
    monkeypatch.setenv("FASTAPI_ENV", "development")  # no built frontend needed to load it
    return importlib.import_module("backend.site")


def test_the_page_and_its_other_files_are_checked_for_a_newer_version_each_time(monkeypatch):
    for path in ("/", "/index.html", "/favicon.ico", "/app-icon.png"):
        assert site(monkeypatch).cache_control(path) == "no-cache", path


def test_built_assets_are_kept_as_they_are_named_by_their_contents(monkeypatch):
    assert site(monkeypatch).cache_control("/assets/index-DP02eaOn.js") == "public, max-age=31536000, immutable"


def test_the_apis_answers_keep_their_own(monkeypatch):
    for path in ("/api", "/api/collections", "/api/pages/x/thumbnail"):
        assert site(monkeypatch).cache_control(path) is None, path


def test_the_site_sends_it(monkeypatch):
    from fastapi.testclient import TestClient
    reply = TestClient(site(monkeypatch).site).get("/api/no-such-thing")
    assert "immutable" not in reply.headers.get("cache-control", "")
