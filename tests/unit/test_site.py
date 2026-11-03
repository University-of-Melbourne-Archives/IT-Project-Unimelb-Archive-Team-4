"""How long a browser may keep what the installed app's site serves: the page itself is checked again each time, so an update
shows at once; the built assets, named by their contents, are kept once found; the API's answers keep their own."""
import importlib

from fastapi.testclient import TestClient

IMMUTABLE = "public, max-age=31536000, immutable"


def site(monkeypatch):
    monkeypatch.setenv("FASTAPI_ENV", "development")  # no built frontend needed to load it
    return importlib.import_module("backend.site")


def test_the_page_and_its_other_files_are_checked_for_a_newer_version_each_time(monkeypatch):
    for path in ("/", "/index.html", "/favicon.ico", "/app-icon.png"):
        assert site(monkeypatch).cache_control(path, 200) == "no-cache", path


def test_built_assets_are_kept_as_they_are_named_by_their_contents(monkeypatch):
    for status in (200, 304):
        assert site(monkeypatch).cache_control("/assets/index-DP02eaOn.js", status) == IMMUTABLE, status


def test_the_apis_answers_keep_their_own(monkeypatch):
    for path in ("/api", "/api/collections", "/api/pages/x/thumbnail"):
        assert site(monkeypatch).cache_control(path, 200) is None, path


def test_the_site_sends_it_and_a_missing_asset_is_not_kept(monkeypatch, tmp_path):
    dist = tmp_path / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>")
    (dist / "assets" / "index-DP02eaOn.js").write_text("")
    monkeypatch.setattr("backend.common.ROOT", tmp_path)
    client = TestClient(importlib.reload(site(monkeypatch)).site)  # serving the built frontend above
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/assets/index-DP02eaOn.js").headers["cache-control"] == IMMUTABLE
    assert client.get("/assets/index-gone.js").headers["cache-control"] == "no-cache"
    assert "cache-control" not in client.get("/api/no-such-thing").headers
